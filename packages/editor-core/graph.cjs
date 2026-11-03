function parseGraph(text) {
  const graph = JSON.parse(text);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('A graph must contain nodes and edges arrays.');
  const ids = new Set();
  for (const node of graph.nodes) {
    if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw new Error('Nodes must have unique string IDs.');
    if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) throw new Error('Expected a Limulus editor graph with node.data fields.');
    ids.add(node.id);
  }
  const edges = new Set();
  for (const edge of graph.edges) {
    if (typeof edge.id !== 'string' || edges.has(edge.id)) throw new Error('Edges must have unique string IDs.');
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`Edge ${edge.id} references a missing node.`);
    edges.add(edge.id);
  }
  return graph;
}

function nextNumber(graph) {
  let next = Number.isInteger(graph.nextNodeId) ? Math.max(1, graph.nextNodeId) : 1;
  for (const node of graph.nodes) {
    for (const value of [node.id, /^nodes\/(\d+)\.py$/.exec(node.data.scriptPath || '')?.[1]]) {
      if (!/^\d+$/.test(value || '')) continue;
      const n = Number(value);
      if (n >= 1 && n <= 9999) next = Math.max(next, n + 1);
    }
  }
  if (next > 9999) throw new Error('All short node IDs have been used. Create another graph.');
  return next;
}

function mutateGraph(graph, action) {
  switch (action.type) {
    case 'move': {
      for (const move of action.nodes || []) {
        const node = graph.nodes.find(n => n.id === move.id);
        if (node && Number.isFinite(move.position?.x) && Number.isFinite(move.position?.y)) node.position = move.position;
      }
      break;
    }
    case 'connect': {
      if (!graph.nodes.some(n => n.id === action.source) || !graph.nodes.some(n => n.id === action.target)) throw new Error('Connection refers to a missing node.');
      if (action.source === action.target) throw new Error('A node cannot connect to itself.');
      const reachable = new Set();
      const visit = id => { if (reachable.has(id)) return; reachable.add(id); for (const e of graph.edges) if (e.source === id) visit(e.target); };
      visit(action.target);
      if (reachable.has(action.source)) throw new Error('This connection would create a cycle.');
      if (!graph.edges.some(e => e.source === action.source && e.target === action.target)) {
        graph.edges.push({ id: globalThis.crypto.randomUUID(), source: action.source, target: action.target, sourceHandle: 'out', targetHandle: 'in', data: { disabled: false } });
      }
      break;
    }
    case 'remove': {
      const ids = new Set(action.nodeIds || []), edgeIds = new Set(action.edgeIds || []);
      graph.nodes = graph.nodes.filter(n => !ids.has(n.id));
      graph.edges = graph.edges.filter(e => !edgeIds.has(e.id) && !ids.has(e.source) && !ids.has(e.target));
      break;
    }
    case 'toggleEdge': {
      const edge = graph.edges.find(e => e.id === action.id);
      if (edge) {
        const disabled = edge.data?.disabled === true || String(edge.style?.stroke || '').includes('0.3');
        edge.data = { ...edge.data, disabled: !disabled };
        // Remove the desktop UI's legacy disabled color without discarding other styling.
        edge.style = { ...edge.style, stroke: !disabled ? '#888888' : '#00bfff' };
      }
      break;
    }
    case 'rename': {
      const node = graph.nodes.find(n => n.id === action.id);
      if (node && typeof action.title === 'string' && action.title.trim()) node.data.title = action.title.trim().slice(0, 120);
      break;
    }
    default: throw new Error(`Unknown graph edit: ${action.type}`);
  }
  return graph;
}
module.exports = { parseGraph, nextNumber, mutateGraph };
