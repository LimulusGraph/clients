const { defaultPython, venvPython } = require('@limulus/node-host/platform');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Runtime, readEvents } = require('../src/runtime.cjs');

const root = path.resolve(__dirname, '..');
const output = { append() {}, appendLine() {} };

test('SSE parser handles split unicode, multiple frames, and CRLF', async () => {
  const text = 'data: {"kind":"log","text":"λ"}\r\n\r\ndata: {"kind":"completed","success":true}\n\n';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const events = [];
  await readEvents(new Response(stream), e => events.push(e));
  assert.equal(events[0].text, 'λ');
  assert.equal(events[1].success, true);
  await assert.rejects(readEvents(new Response('data: {"kind":"log"}\n\n'), () => {}), /before execution completed/);
});

test('managed backend starts once, requires its token, runs universes, and stops', { timeout: 20000 }, async t => {
  const runtime = new Runtime(root, () => ({ pythonPath: defaultPython() }), output);
  t.after(() => runtime.stop());
  let first, second;
  try { [first, second] = await Promise.all([runtime.start(), runtime.start()]); }
  catch (error) {
    if (error.message.includes('bind: operation not permitted')) { t.skip('Sandbox prohibits localhost binding. Run this integration test outside the sandbox.'); return; }
    throw error;
  }
  assert.equal(first, second);
  assert.match(first, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(`${first}/api/health`)).status, 401);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-runtime-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'a.py'), "class Model:\n    def predict(self): return 42\nmodel = Model()\n");
  await fs.writeFile(path.join(dir, 'b.py'), "assert isinstance(model, Model)\ncount = globals().get('count', 0) + 1\nprint(model.predict(), count)\n");
  const project = path.join(dir, 'graph.lmg');
  await fs.writeFile(project, JSON.stringify({ nodes: ['a', 'b'].map(id => ({ id, data: { scriptPath: `${id}.py` } })), edges: [{ id: 'ab', source: 'a', target: 'b' }] }));
  const events = [];
  await runtime.run(project, '', 'all', event => events.push(event));
  await runtime.run(project, 'b', 'node_only', event => events.push(event));
  assert.ok(events.some(e => e.kind === 'log' && e.text.includes('42 2')));
  assert.equal(events.at(-1).kind, 'completed');
  assert.equal(events.at(-1).success, true);
  await runtime.stop();
  assert.equal(runtime.child, null);
  await assert.rejects(fetch(`${first}/api/health`));
});

test('cancellation aborts a live run and permits a new run', { timeout: 20000 }, async t => {
  const runtime = new Runtime(root, () => ({}), output);
  t.after(() => runtime.stop());
  try { await runtime.start(); }
  catch (error) {
    if (error.message.includes('bind: operation not permitted')) { t.skip('Sandbox prohibits localhost binding. Run this integration test outside the sandbox.'); return; }
    throw error;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-cancel-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'graph.lmg');
  await fs.writeFile(project, JSON.stringify({ nodes: [{ id: 'a', data: { scriptPath: 'a.py' } }], edges: [] }));
  await fs.writeFile(path.join(dir, 'a.py'), "print('started')\nwhile True: pass\n");
  const controller = new AbortController();
  await assert.rejects(runtime.run(project, '', 'all', event => { if (event.kind === 'log' && event.text.includes('started')) controller.abort(); }, controller.signal));
  await fs.writeFile(path.join(dir, 'a.py'), "print('recovered')\n");
  const events = [];
  await runtime.run(project, '', 'all', event => events.push(event));
  assert.equal(events.at(-1).success, true);
});

test('disposed managers cannot restart from late editor cleanup', async () => {
  const runtime = new Runtime(root, () => ({}), output);
  await runtime.dispose();
  await assert.rejects(runtime.start(), /closed/);
});
