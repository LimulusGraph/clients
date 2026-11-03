const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseGraph, nextNumber, addNode, sourcePath, ensureSource, mutateGraph } = require('../src/graph.cjs');
async function project(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-extension-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'graph.lmg');
}

test('short IDs survive deletion, Undo, existing source files, and reload', async t => {
  const filename = await project(t);
  let graph = { nodes: [], edges: [], metadata: { keep: true } };
  const first = await addNode(graph, filename);
  assert.equal(first.id, '1');
  await fs.writeFile(path.join(path.dirname(filename), 'nodes/1.py'), 'important code');
  mutateGraph(graph, { type: 'remove', nodeIds: ['1'] });
  graph = parseGraph(JSON.stringify(graph));
  assert.equal((await addNode(graph, filename)).id, '2');
  // Undo can restore an older counter; orphaned files still must not be reused.
  const undone = { nodes: [], edges: [] };
  assert.equal((await addNode(undone, filename)).id, '3');
  assert.equal(await fs.readFile(path.join(path.dirname(filename), 'nodes/1.py'), 'utf8'), 'important code');
  assert.deepEqual(graph.metadata, { keep: true });
  assert.throws(() => nextNumber({ nodes: [], nextNodeId: 10000 }), /short node IDs/);
});

test('graph patches preserve unknown fields and block cycles', () => {
  const graph = { nodes: ['a', 'b', 'c'].map(id => ({ id, data: { scriptPath: `${id}.py`, custom: 'keep' } })), edges: [], nextNodeId: 8, custom: 3 };
  mutateGraph(graph, { type: 'connect', source: 'a', target: 'b' });
  mutateGraph(graph, { type: 'connect', source: 'b', target: 'c' });
  assert.throws(() => mutateGraph(graph, { type: 'connect', source: 'c', target: 'a' }), /cycle/);
  mutateGraph(graph, { type: 'move', nodes: [{ id: 'a', position: { x: 9, y: 10 } }] });
  mutateGraph(graph, { type: 'rename', id: 'a', title: 'New title' });
  assert.equal(graph.nodes[0].data.custom, 'keep');
  assert.equal(graph.custom, 3);
  const edge = graph.edges[0];
  mutateGraph(graph, { type: 'toggleEdge', id: edge.id });
  assert.equal(edge.data.disabled, true);
  mutateGraph(graph, { type: 'toggleEdge', id: edge.id });
  assert.equal(edge.data.disabled, false);
  mutateGraph(graph, { type: 'remove', nodeIds: ['b'] });
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.nextNodeId, 8);
});

test('source resolution rejects traversal and symlink escapes', async t => {
  const filename = await project(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await assert.rejects(sourcePath(filename, '../escape.py'), /outside/);
  await assert.rejects(sourcePath(filename, '/tmp/escape.py'), /relative/);
  await fs.symlink(outside, path.join(path.dirname(filename), 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(sourcePath(filename, 'linked/model.py'), /outside/);
  const source = await ensureSource(filename, { data: { scriptPath: 'nodes/model.py' } });
  await fs.writeFile(source, 'saved = 1');
  await ensureSource(filename, { data: { scriptPath: 'nodes/model.py' } });
  assert.equal(await fs.readFile(source, 'utf8'), 'saved = 1');
});

test('malformed editor graphs fail without losing their contents', () => {
  assert.throws(() => parseGraph('{'), SyntaxError);
  assert.throws(() => parseGraph('{"nodes":[],"edges":[{"id":"x","source":"missing","target":"missing"}]}'), /missing/);
  assert.throws(() => parseGraph('{"nodes":[{"id":"a"}],"edges":[]}'), /node.data/);
});
