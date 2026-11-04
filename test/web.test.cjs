const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { start, createHost } = require('../apps/web/server.cjs');
const { Readable, Writable } = require('node:stream');
const { readEvents } = require('@limulus/editor-core/events');

async function setup(t, runtime) {
  let host;
  if (runtime) {
    host = createHost({ port: 3000, runtime });
    host.fetch = (url, options = {}) => new Promise((resolve, reject) => {
      const request = Readable.from([Buffer.from(options.body || '')]);
      request.url = new URL(url, host.url).pathname;
      request.method = options.method || 'GET';
      request.headers = Object.fromEntries(Object.entries({ host: '127.0.0.1:3000', ...options.headers }).map(([key, value]) => [key.toLowerCase(), value]));
      const chunks = [];
      const response = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
      response.writeHead = (status, headers = {}) => { response.status = status; response.headers = headers; response.headersSent = true; return response; };
      response.once('finish', () => resolve(new Response(Buffer.concat(chunks), { status: response.status || 200, headers: response.headers })));
      response.once('error', reject);
      host.server.emit('request', request, response);
    });
  } else {
    try { host = await start({ port: 0 }); }
    catch (error) { if (error.code === 'EPERM') { t.skip('Sandbox prohibits localhost binding.'); return null; } throw error; }
    host.fetch = global.fetch;
  }
  t.after(() => host.close());
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-workspace-test-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'graph.lmg');
  await fs.writeFile(project, '{"nodes":[],"edges":[],"custom":{"keep":true}}');
  const post = async (operation, data) => {
    const response = await host.fetch(`${host.url}/api/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: project, ...data }) });
    if (!response.ok) throw new Error((await response.json()).error);
    return response.json();
  };
  return { host, directory, project, post };
}

test('web host preserves metadata, source files and Undo IDs, rejects cycles, relocates dependencies', async t => {
  const { post, project, directory } = await setup(t, { async dispose() {} });
  let { graph } = await post('open');
  const empty = structuredClone(graph);
  ({ graph } = await post('edit', { graph, action: { type: 'add' } }));
  await post('source', { graph, id: '1', code: 'print(42)\n' });
  const afterUndo = await post('edit', { graph: empty, action: { type: 'add' } });
  assert.equal(afterUndo.graph.nodes[0].id, '2');
  assert.equal(await fs.readFile(path.join(directory, 'nodes/node_1.py'), 'utf8'), 'print(42)\n');
  ({ graph } = await post('edit', { graph, action: { type: 'add' } }));
  ({ graph } = await post('edit', { graph, action: { type: 'connect', source: '1', target: '3' } }));
  await assert.rejects(post('edit', { graph, action: { type: 'connect', source: '3', target: '1' } }), /cycle/);
  await post('save', { graph });
  assert.deepEqual(JSON.parse(await fs.readFile(project, 'utf8')).custom, { keep: true });
  await post('dependencies', { code: '# no third-party requirements\n' });
  const destination = path.join(directory, 'copy', 'copy.lmg');
  await post('save-as', { graph, destination });
  assert.equal(await fs.readFile(path.join(directory, 'copy/nodes/node_1.py'), 'utf8'), 'print(42)\n');
  assert.equal(await fs.readFile(path.join(directory, 'copy/requirements.txt'), 'utf8'), '# no third-party requirements\n');
  await assert.rejects(post('save-as', { graph, destination }), /already exists/);
  const bad = { nodes: [{ id: '1', data: { scriptPath: '../escape.py' } }], edges: [] };
  await assert.rejects(post('source', { graph: bad, id: '1' }), /outside/);
});

test('web adapter uses the shared editor contract, flushes drafts, and keeps runtime state out of graph files', async t => {
  const calls = [];
  const runtime = { async dispose() {}, async run(project, id, mode, emit) {
    calls.push({ project, mode });
    if (mode !== 'reset') assert.equal(await fs.readFile(path.join(path.dirname(project), 'nodes/node_1.py'), 'utf8'), 'answer = 42\n');
    emit({ kind: 'node_started', node_id: '1', route_id: 'a' });
    emit({ kind: 'completed', success: true });
  } };
  const { host, post, project } = await setup(t, runtime);
  const { WebHost } = await import('../apps/web/src/host.js');
  const originalFetch = global.fetch;
  global.fetch = (url, options) => host.fetch(url, options);
  t.after(() => { global.fetch = originalFetch; });
  const adapter = new WebHost(await post('open'));
  const messages = []; adapter.subscribe(message => messages.push(message));
  adapter.send({ type: 'ready' });
  assert.equal(messages.at(-1).type, 'graph');
  await adapter.edit({ type: 'add' });
  adapter.draft({ id: '1' }, 'answer = 42\n');
  adapter.send({ type: 'run', mode: 'all' });
  await adapter.queue; await adapter.execution;
  assert.equal(calls[0].mode, 'all');
  assert.equal(adapter.running, false);
  assert.equal(adapter.drafts.size, 0);
  assert.ok(messages.some(message => message.type === 'event' && message.event.kind === 'completed'));
  const saved = JSON.parse(await fs.readFile(project, 'utf8'));
  assert.equal(saved.nodes[0].data.runtimeStatus, undefined);
  await adapter.undo();
  const text = await fs.readFile(project, 'utf8');
  await adapter.dispose();
  assert.equal(await fs.readFile(project, 'utf8'), text, 'closing must not save an undone graph');
});

test('web standalone host executes real Python, streams results and resets runtimes', { timeout: 30000 }, async t => {
  const setupResult = await setup(t);
  if (!setupResult) return;
  const { host, post, project } = setupResult;
  let { graph } = await post('open');
  ({ graph } = await post('edit', { graph, action: { type: 'add' } }));
  await post('source', { graph, id: '1', code: "counter = globals().get('counter', 0) + 1\nprint('web result', counter)\n" });
  const run = async mode => {
    const response = await fetch(`${host.url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: project, graph, mode, id: '1' }) });
    const events = []; await readEvents(response, event => events.push(event)); return events;
  };
  assert.ok((await run('all')).some(event => event.kind === 'log' && event.text.includes('web result 1')));
  assert.ok((await run('node_only')).some(event => event.kind === 'log' && event.text.includes('web result 2')));
  assert.equal((await run('reset')).at(-1).success, true);
  const denied = await fetch(`${host.url}/api/open`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify({ path: project }) });
  assert.equal(denied.status, 403);
});

test('failed web setup restores editor state and closing an unused tab never starts a runtime', async t => {
  let runs = 0;
  const { host, post } = await setup(t, { async dispose() {}, async run() { runs++; throw new Error('Setup failed'); } });
  const { WebHost } = await import('../apps/web/src/host.js');
  const originalFetch = global.fetch;
  global.fetch = (url, options) => host.fetch(url, options);
  t.after(() => { global.fetch = originalFetch; });
  const adapter = new WebHost(await post('open'));
  const unused = new WebHost(await post('open'));
  await unused.dispose();
  assert.equal(runs, 0);
  const messages = []; adapter.subscribe(message => messages.push(message));
  await adapter.run('all');
  assert.equal(adapter.running, false);
  assert.equal(messages.at(-1).type, 'running');
  assert.equal(messages.at(-1).value, false);
  assert.ok(messages.some(message => message.type === 'event' && message.event.text === 'Setup failed'));
});

test('browser rename saves drafts and graph, refreshes source, and moves files on Undo/Redo', async t => {
  const { host, post, project, directory } = await setup(t, { async dispose() {} });
  const { WebHost } = await import('../apps/web/src/host.js');
  const originalFetch = global.fetch, originalWindow = global.window;
  global.fetch = (url, options) => host.fetch(url, options);
  global.window = { prompt: () => 'TrainModel' };
  t.after(() => { global.fetch = originalFetch; global.window = originalWindow; });
  let displayed;
  const adapter = new WebHost(await post('open'), () => {}, value => { displayed = value; });
  await adapter.edit({ type: 'add' });
  await adapter.showSource('1');
  adapter.draft(displayed, 'model = 42\n');
  await adapter.edit({ type: 'rename', id: '1' });
  const target = path.join(directory, 'nodes/train_model.py');
  const old = path.join(directory, 'nodes/node_1.py');
  assert.equal(displayed.filename, target);
  assert.equal(displayed.title, 'TrainModel');
  assert.equal(displayed.code, 'model = 42\n');
  assert.equal(adapter.drafts.size, 0);
  assert.equal(adapter.dirty, false);
  assert.equal(JSON.parse(await fs.readFile(project, 'utf8')).nodes[0].data.scriptPath, 'nodes/train_model.py');
  await assert.rejects(fs.access(old), { code: 'ENOENT' });
  adapter.draft(displayed, 'model = 43\n');
  await adapter.undo();
  assert.equal(displayed.filename, old);
  assert.equal(displayed.title, 'Node 1');
  assert.equal(await fs.readFile(old, 'utf8'), 'model = 43\n');
  await assert.rejects(fs.access(target), { code: 'ENOENT' });
  await adapter.redo();
  assert.equal(displayed.filename, target);
  assert.equal(await fs.readFile(target, 'utf8'), 'model = 43\n');
  // An unrelated file created at the old path must block Undo without consuming history.
  await fs.writeFile(old, 'do not replace\n');
  const historyLength = adapter.history.length;
  await assert.rejects(adapter.undo(), /already exists/);
  assert.equal(adapter.history.length, historyLength);
  assert.equal(adapter.graph.nodes[0].data.scriptPath, 'nodes/train_model.py');
  assert.equal(await fs.readFile(old, 'utf8'), 'do not replace\n');
});

test('browser rename rolls back the file move when saving the graph fails', async t => {
  const { post, directory, project } = await setup(t, { async dispose() {} });
  let { graph } = await post('open');
  ({ graph } = await post('edit', { graph, action: { type: 'add' } }));
  await post('source', { graph, id: '1', code: 'important = True\n' });
  await fs.unlink(project);
  await fs.mkdir(project); // A directory cannot be replaced by the graph file.
  await assert.rejects(post('edit', { graph, action: { type: 'rename', id: '1', title: 'New name' } }));
  assert.equal(await fs.readFile(path.join(directory, 'nodes/node_1.py'), 'utf8'), 'important = True\n');
  await assert.rejects(fs.access(path.join(directory, 'nodes/new_name.py')), { code: 'ENOENT' });
});
