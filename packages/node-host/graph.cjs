const path = require('node:path');
const fs = require('node:fs/promises');
const { parseGraph, nextNumber, mutateGraph, sourceName } = require('@limulus/editor-core/graph');

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
    try { await fs.lstat(await sourcePath(projectPath, `nodes/${number}.py`)); number++; continue; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const node = { id: String(number), type: 'custom', position, data: { title: `Node ${number}`, scriptPath: `nodes/node_${number}.py` } };
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

// Planning has no filesystem side effects, so hosts can apply the graph and file
// change together (a WorkspaceEdit in VS Code, a saved edit in the browser).
async function planSourceMove(graph, projectPath, id, scriptPath) {
  const node = graph.nodes.find(n => n.id === id);
  if (!node) throw new Error('Node no longer exists.');
  const from = await sourcePath(projectPath, node.data.scriptPath);
  const to = await sourcePath(projectPath, scriptPath);
  if (from === to) return { from, to, scriptPath };
  const stat = await fs.lstat(from);
  if (!stat.isFile()) throw new Error('Only regular Python source files can be renamed.');
  const real = await fs.realpath(from);
  for (const other of graph.nodes) {
    if (other.id === id) continue;
    const filename = await sourcePath(projectPath, other.data.scriptPath);
    if (filename === to) throw new Error('Another node already uses that source filename.');
    if (await fs.realpath(filename).catch(error => { if (error.code === 'ENOENT') return filename; throw error; }) === real) {
      throw new Error('This source file is shared by another node. Give the node its own source file before renaming it.');
    }
  }
  try { await fs.lstat(to); throw new Error(`Source file already exists: ${scriptPath}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { from, to, scriptPath };
}

async function planNodeRename(graph, projectPath, id, title) {
  if (typeof title !== 'string' || !title.trim()) throw new Error('Enter a node name.');
  title = title.trim().slice(0, 120);
  const node = graph.nodes.find(n => n.id === id);
  if (!node) throw new Error('Node no longer exists.');
  const filename = sourceName(title);
  const directory = path.posix.dirname(node.data.scriptPath || '');
  const move = await planSourceMove(graph, projectPath, id, path.posix.join(directory, filename));
  return { ...move, title };
}

async function moveSource(move) {
  if (move.from === move.to) return;
  // A hard link reserves the destination without overwriting it, unlike rename
  // on POSIX. Both names are in the same source directory/filesystem.
  await fs.link(move.from, move.to);
  try { await fs.unlink(move.from); }
  catch (error) { await fs.unlink(move.to); throw error; }
}

module.exports = { parseGraph, nextNumber, mutateGraph, sourcePath, ensureSource, addNode, sourceName, planNodeRename, planSourceMove, moveSource };
