const { defaultPython, backendName, terminate } = require('./platform.cjs');
const { ProjectEnvironment } = require('./environment.cjs');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

const { readEvents } = require('@limulus/editor-core/events');

class Runtime {
  constructor(extensionPath, config, output) {
    this.extensionPath = extensionPath;
    this.config = config;
    this.output = output;
    this.child = null;
    this.starting = null;
    this.endpoint = null;
    this.controllers = new Set();
    this.environments = new ProjectEnvironment(config);
    this.directoryQueues = new Map();
    this.projects = new Set();
  }
  async start() {
    if (this.disposed) throw new Error('Limulus runtime manager is closed.');
    if (this.stopping) await this.stopping;
    if (this.disposed) throw new Error('Limulus runtime manager is closed.');
    if (this.starting) return this.starting;
    if (this.endpoint && this.child) return this.endpoint;
    this.starting = this.launch();
    try { return await this.starting; } finally { this.starting = null; }
  }
  async launch() {
    if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('Limulus runtimes currently support macOS, Linux and Windows.');
    const settings = this.config();
    const binary = settings.serverPath || path.join(this.extensionPath, 'bin', backendName());
    await fs.access(binary);
    this.token = randomBytes(32).toString('hex');
    const child = spawn(binary, [], { windowsHide: true, cwd: this.extensionPath, env: { ...process.env, PYTHONUTF8: '1', LIMULUS_HOST: '127.0.0.1', LIMULUS_PORT: '0', LIMULUS_TOKEN: this.token, LIMULUS_PYTHON: settings.pythonPath || defaultPython() }, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    const ready = new Promise((resolve, reject) => {
      let pending = '', settled = false, startupError = '';
      const finish = (err, endpoint) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { terminate(child); reject(err); } else resolve(endpoint);
      };
      const timer = setTimeout(() => finish(new Error('Timed out starting the Limulus server. See Limulus output.')), 15000);
      child.stdout.on('data', bytes => {
        const text = bytes.toString(); this.output.append(text); pending += text;
        let end;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
          const match = /^LIMULUS_LISTEN_ADDR=(127\.0\.0\.1:\d+)$/.exec(line);
          if (match) finish(null, `http://${match[1]}`);
        }
      });
      child.stderr.on('data', data => { this.output.append(data.toString()); startupError = (startupError + data.toString()).slice(-4000); });
      child.once('error', error => finish(error));
      child.once('exit', (code, signal) => {
        if (this.child === child) { this.child = null; this.endpoint = null; }
        this.output.appendLine(`Limulus server stopped (${signal || code}).`);
        finish(new Error(`Limulus server exited before startup (${signal || code}). ${startupError.trim()}`));
      });
    });
    const endpoint = await ready;
    const response = await fetch(`${endpoint}/api/health`, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) { terminate(child); throw new Error('Limulus server health check failed.'); }
    this.endpoint = endpoint;
    return endpoint;
  }
  async run(projectPath, nodeId, mode, onEvent, signal) {
    if (this.disposed) throw new Error('Limulus runtime manager is closed.');
    signal?.throwIfAborted();
    const directory = await fs.realpath(path.dirname(projectPath));
    projectPath = path.join(directory, path.basename(projectPath));
    const callerSignal = signal;
    const setupController = new AbortController();
    const cancelSetup = () => setupController.abort();
    callerSignal?.addEventListener('abort', cancelSetup, { once: true });
    if (callerSignal?.aborted) cancelSetup();
    signal = setupController.signal;
    this.controllers.add(setupController);
    const previous = this.directoryQueues.get(directory) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      if (mode !== 'reset') {
        await this.environments.prepare(projectPath, onEvent, signal, mode === 'dependencies', async () => {
          // Pip must not mutate packages loaded by another graph in this folder.
          for (const project of this.projects) {
            if (path.dirname(project) === directory) await this.requestRun(project, '', 'reset', () => {}, signal);
          }
        });
      }
      if (mode === 'dependencies') {
        onEvent({ kind: 'completed', success: true, text: 'Project dependencies installed. Run all or Run through node to initialize fresh runtimes.' });
        return;
      }
      this.projects.add(projectPath);
      await this.requestRun(projectPath, nodeId, mode, onEvent, signal);
    });
    this.directoryQueues.set(directory, job);
    try { return await job; } finally {
      callerSignal?.removeEventListener('abort', cancelSetup);
      this.controllers.delete(setupController);
      if (this.directoryQueues.get(directory) === job) this.directoryQueues.delete(directory);
    }
  }
  async requestRun(projectPath, nodeId, mode, onEvent, signal) {
    signal?.throwIfAborted();
    const endpoint = await this.start();
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.controllers.add(controller);
    try {
      const params = new URLSearchParams({ project_path: projectPath, node_id: nodeId || '', run_mode: mode });
      const response = await fetch(`${endpoint}/api/node/run?${params}`, { headers: { Authorization: `Bearer ${this.token}` }, signal: controller.signal });
      await readEvents(response, onEvent);
    } finally { signal?.removeEventListener('abort', abort); this.controllers.delete(controller); }
  }
  async dispose() {
    this.disposed = true;
    await this.stop();
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopProcess();
    try { await this.stopping; } finally { this.stopping = null; }
  }
  async stopProcess() {
    if (this.starting) { try { await this.starting; } catch {} }
    for (const controller of this.controllers) controller.abort();
    const child = this.child;
    this.endpoint = null;
    if (!child) return;
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => terminate(child, { signal: 'SIGKILL' }), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      terminate(child);
    });
    if (this.child === child) this.child = null;
  }
}
module.exports = { Runtime, readEvents };
