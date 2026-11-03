const test = require('node:test');
const assert = require('node:assert/strict');
const { applyEvent, statusFor } = require('@limulus/editor-core/execution');
const { mutateGraph } = require('@limulus/editor-core/graph');

test('execution statuses combine parallel universes without changing graph data', () => {
  const statuses = new Map();
  applyEvent(statuses, { kind: 'node_started', node_id: '1', route_id: 'a' });
  applyEvent(statuses, { kind: 'node_finished', node_id: '1', route_id: 'b', success: false });
  assert.equal(statusFor(statuses, '1'), 'running');
  applyEvent(statuses, { kind: 'node_finished', node_id: '1', route_id: 'a', success: true });
  assert.equal(statusFor(statuses, '1'), 'error');
  assert.equal(statusFor(statuses, '2'), '');
});

test('legacy disabled edges migrate to explicit flags, keeping unrelated fields', () => {
  const graph = { nodes: [{ id: '1', data: {} }, { id: '2', data: {} }], edges: [{ id: 'edge', source: '1', target: '2', data: { custom: 42 }, style: { stroke: 'rgba(200,200,200,0.3)', opacity: .5 } }] };
  mutateGraph(graph, { type: 'toggleEdge', id: 'edge' });
  assert.equal(graph.edges[0].data.disabled, false);
  assert.equal(graph.edges[0].data.custom, 42);
  assert.equal(graph.edges[0].style.opacity, .5);
  assert.throws(() => mutateGraph(graph, { type: 'connect', source: '2', target: '1' }), /cycle/);
});
