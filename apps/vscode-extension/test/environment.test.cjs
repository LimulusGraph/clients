const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ProjectEnvironment, runProcess } = require('../src/environment.cjs');

test('real venv installs an offline wheel, reuses packages and synchronizes changes', { timeout: 60000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-pip-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await runProcess('python3', ['-c', `import zipfile
with zipfile.ZipFile('limulus_fixture-1.0-py3-none-any.whl', 'w') as wheel:
    wheel.writestr('limulus_fixture.py', 'answer = 42\\n')
    wheel.writestr('limulus_fixture-1.0.dist-info/METADATA', 'Metadata-Version: 2.1\\nName: limulus-fixture\\nVersion: 1.0\\n')
    wheel.writestr('limulus_fixture-1.0.dist-info/WHEEL', 'Wheel-Version: 1.0\\nGenerator: test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')
    wheel.writestr('limulus_fixture-1.0.dist-info/RECORD', '')
`], directory, () => {});
  const requirements = '--no-index\n./limulus_fixture-1.0-py3-none-any.whl\n';
  await fs.writeFile(path.join(directory, 'requirements.txt'), requirements);
  let installs = 0, resets = 0;
  const env = new ProjectEnvironment(() => ({ pythonPath: 'python3' }), async (...args) => { if (args[1].includes('pip')) installs++; await runProcess(...args); });
  const project = path.join(directory, 'graph.lmg');
  const python = await env.prepare(project, () => {}, undefined, false, async () => { resets++; });
  await runProcess(python, ['-c', 'import sys, limulus_fixture; assert sys.prefix != sys.base_prefix; assert limulus_fixture.answer == 42'], directory, () => {});
  await env.prepare(project, () => {});
  assert.equal(installs, 1); assert.equal(resets, 1);
  await fs.writeFile(path.join(directory, 'requirements.txt'), requirements + '# change\n');
  await env.prepare(project, () => {}); assert.equal(installs, 2);
  await env.prepare(project, () => {}, undefined, true); assert.equal(installs, 3);
  assert.equal(await fs.readFile(path.join(directory, '.venv/.gitignore'), 'utf8'), '*\n');
});

test('failed setup can retry and never overwrites an existing unrelated directory', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-pip-fail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = new ProjectEnvironment(() => ({}), async () => { await fs.mkdir(path.join(directory, '.venv')); throw new Error('cancelled'); });
  await assert.rejects(env.prepare(path.join(directory, 'g.lmg'), () => {}), /cancelled/);
  await assert.rejects(fs.access(path.join(directory, '.venv')), { code: 'ENOENT' });
  await fs.mkdir(path.join(directory, '.venv'));
  await fs.writeFile(path.join(directory, '.venv/keep'), 'keep');
  await assert.rejects(env.prepare(path.join(directory, 'g.lmg'), () => {}), /not a complete/);
  assert.equal(await fs.readFile(path.join(directory, '.venv/keep'), 'utf8'), 'keep');
});

test('runtime serializes shared-folder setup and resets live projects before reinstall', async t => {
  const { Runtime } = require('../src/runtime.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-env-queue-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = new Runtime(directory, () => ({}), { append() {}, appendLine() {} });
  const operations = [];
  runtime.environments.prepare = async (project, emit, signal, force, reset) => {
    operations.push(`setup:${path.basename(project)}`);
    await reset();
  };
  runtime.requestRun = async (project, node, mode) => { operations.push(`${mode}:${path.basename(project)}`); await new Promise(resolve => setTimeout(resolve, 5)); };
  await Promise.all(['a.lmg', 'b.lmg'].map(name => runtime.run(path.join(directory, name), '', 'all', () => {})));
  // realpath may resolve either caller first; setup and execution must still be serialized.
  const first = operations[0].slice('setup:'.length);
  assert.ok(['a.lmg', 'b.lmg'].includes(first));
  const second = first === 'a.lmg' ? 'b.lmg' : 'a.lmg';
  assert.deepEqual(operations, [`setup:${first}`, `all:${first}`, `setup:${second}`, `reset:${first}`, `all:${second}`]);
  await runtime.dispose();
  await assert.rejects(runtime.run(path.join(directory, 'a.lmg'), '', 'all', () => {}), /closed/);
});

test('failed pip installs are retried instead of cached as successful', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-pip-retry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, '.venv/bin'), { recursive: true });
  await fs.writeFile(path.join(directory, '.venv/pyvenv.cfg'), '');
  await fs.writeFile(path.join(directory, '.venv/bin/python'), '');
  await fs.writeFile(path.join(directory, 'requirements.txt'), 'example\n');
  let attempts = 0;
  const env = new ProjectEnvironment(() => ({}), async () => { if (++attempts === 1) throw new Error('pip failed'); });
  const project = path.join(directory, 'g.lmg');
  await assert.rejects(env.prepare(project, () => {}), /pip failed/);
  await env.prepare(project, () => {});
  await env.prepare(project, () => {});
  assert.equal(attempts, 2);
});
