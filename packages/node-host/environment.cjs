const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function runProcess(executable, args, cwd, emit, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1', PYTHONNOUSERSITE: '1' } });
    let tail = '';
    for (const [source, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      stream.setEncoding('utf8');
      stream.on('data', text => { tail = (tail + text).slice(-3000); emit({ kind: 'log', source, text }); });
    }
    const abort = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('Dependency setup cancelled.'));
      else if (code !== 0) reject(new Error(`Python dependency setup failed (${code}). ${tail.trim()}`));
      else resolve();
    });
  });
}

class ProjectEnvironment {
  constructor(config, execute = runProcess) { this.config = config; this.execute = execute; this.installed = new Map(); }
  async prepare(project, emit, signal, force = false, beforeInstall = async () => {}) {
    const directory = path.dirname(project);
    const environment = path.join(directory, '.venv');
    const python = path.join(environment, 'bin', 'python');
    let exists = true;
    try { await fs.access(path.join(environment, 'pyvenv.cfg')); await fs.access(python); }
    catch { exists = false; }
    if (!exists) {
      this.installed.delete(directory);
      // Never overwrite an unrelated or incomplete existing folder.
      try { await fs.access(environment); throw new Error(`Cannot use ${environment}: it is not a complete virtual environment. Rename or remove it and try again.`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      emit({ kind: 'log', source: 'dependencies', text: `Creating ${environment}\n` });
      try {
        await this.execute(this.config().pythonPath || 'python3', ['-m', 'venv', environment], directory, emit, signal);
      } catch (error) {
        await fs.rm(environment, { recursive: true, force: true });
        throw error;
      }
      await fs.writeFile(path.join(environment, '.gitignore'), '*\n');
    }
    const requirements = path.join(directory, 'requirements.txt');
    let content;
    try { content = await fs.readFile(requirements); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const fingerprint = createHash('sha256').update(content || '').digest('hex');
    if (force || this.installed.get(directory) !== fingerprint) {
      await beforeInstall();
      // A failed or interrupted pip install must never count as synchronized.
      this.installed.delete(directory);
      if (content !== undefined) {
        emit({ kind: 'log', source: 'dependencies', text: `Installing dependencies from ${requirements}\n` });
        await this.execute(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', requirements], directory, emit, signal);
      }
      this.installed.set(directory, fingerprint);
    }
    return python;
  }
}
module.exports = { ProjectEnvironment, runProcess };
