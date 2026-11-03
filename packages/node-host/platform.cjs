const path = require('node:path');
const { spawn } = require('node:child_process');
const defaultPython = (platform = process.platform) => platform === 'win32' ? 'python' : 'python3';
const venvPython = (directory, platform = process.platform) => path.join(directory, '.venv', ...(platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
const backendName = (platform = process.platform, arch = process.arch) => `limulus-server-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;

function terminate(child, { group = false, signal = 'SIGTERM' } = {}) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Node's child.kill only stops the parent on Windows. Pip and the Go server
    // can own Python descendants, which must be terminated as well.
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => child.kill());
    killer.once('exit', code => { if (code && child.exitCode === null) child.kill(); });
  } else if (group) {
    try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
  } else child.kill(signal);
}
module.exports = { defaultPython, venvPython, backendName, terminate };
