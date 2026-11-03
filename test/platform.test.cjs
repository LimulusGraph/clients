const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { defaultPython, venvPython, backendName } = require('@limulus/node-host/platform');
test('Windows uses executable suffixes and Scripts environments', () => {
  assert.equal(defaultPython('win32'), 'python');
  assert.equal(venvPython('project', 'win32'), path.join('project', '.venv', 'Scripts', 'python.exe'));
  assert.equal(backendName('win32', 'x64'), 'limulus-server-win32-x64.exe');
  assert.equal(backendName('win32', 'arm64'), 'limulus-server-win32-arm64.exe');
});
test('POSIX interpreter and backend names remain compatible', () => {
  assert.equal(defaultPython('linux'), 'python3');
  assert.equal(venvPython('project', 'darwin'), path.join('project', '.venv', 'bin', 'python'));
  assert.equal(backendName('darwin', 'arm64'), 'limulus-server-darwin-arm64');
});
