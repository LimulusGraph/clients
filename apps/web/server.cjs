const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Runtime } = require('@limulus/node-host/runtime');
const { parseGraph, mutateGraph, addNode, ensureSource, sourcePath } = require('@limulus/node-host/graph');
const ROOT = __dirname;

async function body(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
function graphFrom(value) { return parseGraph(JSON.stringify(value)); }
async function prepare(project, graph) {
  for (const node of graph.nodes) {
    node.data.scriptPath ||= `nodes/${node.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.py`;
    await ensureSource(project, node);
  }
  return graph;
}
async function save(project, graph) {
  await fs.mkdir(path.dirname(project), { recursive: true });
  await prepare(project, graph);
  const temporary = `${project}.${require('node:crypto').randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(graph, null, 2) + '\n');
    await fs.rename(temporary, project);
  } finally { await fs.rm(temporary, { force: true }); }
}

// Host owns filesystem access and Python processes; neither enters the browser bundle.
function createHost({ port = Number(process.env.PORT || 3000), dev = false, runtime: suppliedRuntime } = {}) {
  const runtime = suppliedRuntime || new Runtime(ROOT, () => ({
    serverPath: process.env.LIMULUS_SERVER_PATH || '', pythonPath: process.env.LIMULUS_PYTHON || 'python3',
  }), { append: value => process.stderr.write(value), appendLine: value => process.stderr.write(value + '\n') });
  const active = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const address = server.address() || { port };
      const allowedHosts = new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`, ...(dev ? ['127.0.0.1:3000', 'localhost:3000'] : [])]);
      if (!allowedHosts.has(req.headers.host)) { res.writeHead(403).end('Invalid host.'); return; }
      if (req.headers.origin && ![...allowedHosts].some(host => req.headers.origin === `http://${host}`)) { res.writeHead(403).end('Invalid origin.'); return; }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') { res.writeHead(405).end(); return; }
        const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const filename = path.resolve(ROOT, 'dist', '.' + relative);
        if (!filename.startsWith(path.join(ROOT, 'dist') + path.sep)) { res.writeHead(403).end(); return; }
        const data = await fs.readFile(filename);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }).end(data); return;
      }
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(405).end('Use POST with JSON.'); return; }
      const input = await body(req);
      const project = input.path ? path.resolve(input.path) : '';
      let result;
      if (url.pathname === '/api/new') {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-web-'));
        const filename = path.join(directory, 'Untitled.lmg');
        const graph = { nextNodeId: 1, nodes: [], edges: [] };
        await save(filename, graph); result = { path: filename, graph };
      } else {
        if (!project || path.extname(project) !== '.lmg') throw new Error('Choose a .lmg project path.');
        if (active.has(project) && !['/api/source', '/api/stop'].includes(url.pathname)) throw new Error('Stop execution before changing this project.');
        switch (url.pathname) {
          case '/api/open': result = { path: project, graph: parseGraph(await fs.readFile(project, 'utf8')) }; break;
          case '/api/edit': {
            const graph = graphFrom(input.graph);
            if (input.action?.type === 'add') {
              const offset = (graph.nodes.length % 5) * 60;
              await addNode(graph, project, { x: 80 + offset, y: 80 + offset });
            } else mutateGraph(graph, input.action);
            result = { graph }; break;
          }
          case '/api/save': {
            const graph = graphFrom(input.graph); await save(project, graph); result = { graph }; break;
          }
          case '/api/save-as': {
            const destination = path.resolve(input.destination || '');
            if (path.extname(destination) !== '.lmg') throw new Error('Choose a .lmg destination.');
            const graph = graphFrom(input.graph);
            if (destination !== project) {
              try { await fs.access(destination); throw new Error('Destination already exists. Choose a new filename.'); }
              catch (error) { if (error.code !== 'ENOENT') throw error; }
              await fs.mkdir(path.dirname(destination), { recursive: true });
              await prepare(project, graph);
              for (const node of graph.nodes) {
                const source = await sourcePath(project, node.data.scriptPath);
                const target = await sourcePath(destination, node.data.scriptPath);
                if (source === target) continue;
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(source, target, require('node:fs').constants.COPYFILE_EXCL);
              }
              const sourceRequirements = path.join(path.dirname(project), 'requirements.txt');
              const targetRequirements = path.join(path.dirname(destination), 'requirements.txt');
              if (sourceRequirements !== targetRequirements) {
                try { await fs.copyFile(sourceRequirements, targetRequirements, require('node:fs').constants.COPYFILE_EXCL); }
                catch (error) { if (error.code !== 'ENOENT') throw error; }
              }
            }
            await save(destination, graph); result = { path: destination, graph }; break;
          }
          case '/api/source': {
            const graph = graphFrom(input.graph);
            const node = graph.nodes.find(n => n.id === input.id);
            if (!node) throw new Error('Node no longer exists.');
            const filename = await ensureSource(project, node);
            if (typeof input.code === 'string') {
              if (active.has(project)) throw new Error('Stop execution before editing source.');
              await fs.writeFile(filename, input.code);
            }
            result = { id: node.id, title: node.data.title, filename, code: await fs.readFile(filename, 'utf8') }; break;
          }
          case '/api/dependencies': {
            const filename = path.join(path.dirname(project), 'requirements.txt');
            if (typeof input.code === 'string') await fs.writeFile(filename, input.code);
            let code = '';
            try { code = await fs.readFile(filename, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            result = { id: 'requirements', title: 'Dependencies', filename, code }; break;
          }
          case '/api/stop': {
            const controller = active.get(project);
            controller?.abort();
            await controller?.finished;
            result = {}; break;
          }
          case '/api/run': {
            if (!['all', 'upstream', 'node_only', 'reset', 'dependencies'].includes(input.mode)) throw new Error('Invalid execution mode.');
            const controller = new AbortController();
            let finish;
            controller.finished = new Promise(resolve => { finish = resolve; });
            active.set(project, controller);
            res.on('close', () => controller.abort());
            try {
              const graph = graphFrom(input.graph);
              if (input.mode !== 'reset') await save(project, graph);
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
              await runtime.run(project, input.id || '', input.mode, event => res.write(`data: ${JSON.stringify(event)}\n\n`), controller.signal);
            } catch (error) {
              if (!res.headersSent) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
              } else if (!res.destroyed) res.write(`data: ${JSON.stringify({ kind: 'completed', success: false, text: error.message })}\n\n`);
            } finally { active.delete(project); finish(); res.end(); }
            return;
          }
          default: res.writeHead(404).end('Unknown API operation.'); return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'application/json' });
      if (!res.writableEnded) res.end(JSON.stringify({ error: error.message }));
    }
  });
  return { server, runtime, get url() { return `http://127.0.0.1:${server.address()?.port ?? port}`; }, async close() {
    for (const controller of active.values()) controller.abort();
    await runtime.dispose();
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  } };
}
async function start(options = {}) {
  const host = createHost(options);
  await new Promise((resolve, reject) => { host.server.once('error', reject); host.server.listen(options.port ?? Number(process.env.PORT || 3000), '127.0.0.1', resolve); });
  return host;
}
if (require.main === module) start().then(host => {
  console.log(`Limulus: ${host.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => host.close().then(() => process.exit()));
}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { start, createHost };
