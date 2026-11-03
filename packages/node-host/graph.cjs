const path = require('node:path');
const fs = require('node:fs/promises');
const { parseGraph, nextNumber, mutateGraph } = require('@limulus/editor-core/graph');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Both lexical and real-path validation: existing symlinks cannot escape the project.
async function sourcePath(projectPath, scriptPath) {
  if (typeof scriptPath !== 'string' || !scriptPath.endsWith('.py') || path.isAbsolute(scriptPath)) throw new Error('Node source must be a relative .py file inside the project folder.');
  const root = await fs.realpath(path.dirname(projectPath));
  const candidate = path.resolve(root, scriptPath);
  if (!inside(root, candidate)) throw new Error('Node source is outside the project folder.');
  let ancestor = candidate;
  for (;;) {
    try {
      const real = await fs.realpath(ancestor);
      if (!inside(root, real)) throw new Error('Node source symlink points outside the project folder.');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  return candidate;
}

async function ensureSource(projectPath, node) {
  const filename = await sourcePath(projectPath, node.data.scriptPath);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  try { await fs.writeFile(filename, '', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return filename;
}

async function addNode(graph, projectPath, position = { x: 80, y: 80 }) {
  let number = nextNumber(graph);
  // Existing/orphaned files (including after Undo) are never silently attached to a new node.
  while (number <= 9999) {
    const node = { id: String(number), type: 'custom', position, data: { title: `Node ${number}`, scriptPath: `nodes/${number}.py` } };
    const filename = await sourcePath(projectPath, node.data.scriptPath);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    try { await fs.writeFile(filename, '', { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') { number++; continue; } throw error; }
    graph.nodes.push(node);
    graph.nextNodeId = number + 1;
    return node;
  }
  throw new Error('All short node IDs or source file names have been used.');
}

module.exports = { parseGraph, nextNumber, mutateGraph, sourcePath, ensureSource, addNode };
