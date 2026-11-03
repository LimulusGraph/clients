const test = require('node:test');
const assert = require('node:assert/strict');
const { renderOutput, appendOutput } = require('../src/output-format.cjs');
const { OutputStore, hash } = require('../src/output-store.cjs');
test('tables and text escape Python values; images accept only PNG base64', () => {
  const html = renderOutput({ output: { kind: 'table', columns: ['<script>'], index: ['"'], rows: [['<img onerror=x>']], total_rows: 200, total_columns: 1, truncated: true } });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img onerror=x&gt;'));
  assert.ok(html.includes('Showing first 1 rows'));
  assert.equal(renderOutput({ output: { kind: 'image', mime: 'image/svg+xml', data: 'abc' } }), '');
  assert.equal(renderOutput({ output: { kind: 'image', mime: 'image/png', data: '" onerror="' } }), '');
  assert.ok(renderOutput({ output: { kind: 'image', mime: 'image/png', data: 'aGVsbG8=' } }).includes('data:image/png;base64,aGVsbG8='));
  assert.ok(renderOutput({ text: '<b>hello</b>' }).includes('&lt;b&gt;hello&lt;/b&gt;'));
});
test('output store isolates projects, universes, nodes and source snapshots', () => {
  const store = new OutputStore();
  const sources = new Map([['1', { filename: '/test.py', hash: hash('print(1)') }]]);
  const routes = new Map();
  const send = (project, route, kind, text = '') => store.record(project, { kind, route_id: route, node_id: '1', text }, sources, 'node_only', routes);
  send('a', 'r1', 'log', 'one'); send('a', 'r2', 'log', 'two'); send('b', 'r1', 'log', 'three');
  send('a', 'r1', 'node_started');
  assert.deepEqual(store.forFile('/test.py').map(r => r.event.text), ['two', 'three']);
  assert.equal(store.records[0].hash, hash('print(1)'));
  assert.notEqual(store.records[0].hash, hash('print(2)'));
  store.record('a', { kind: 'route_started', route_id: 'r2', text: '1 → 2' }, sources, 'upstream', routes);
  assert.deepEqual(store.records.map(r => r.project), ['b']);
  store.clear('b'); assert.equal(store.records.length, 0);
});
test('large output retention is bounded independently of event count', () => {
  const event = { kind: 'log', text: 'x'.repeat(200) };
  assert.equal(appendOutput([event, event], event, 600).length, 1);
  const store = new OutputStore(600);
  const sources = new Map([['1', { filename: '/test.py', hash: '' }]]);
  for (let i = 0; i < 10; i++) store.record('a', { ...event, node_id: '1' }, sources, 'all', new Map());
  assert.equal(store.records.length, 1);
  assert.ok(store.bytes <= 600);
});
