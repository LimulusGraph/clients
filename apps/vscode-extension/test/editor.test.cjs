const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Exercise the real provider against the VS Code document contract without launching Electron.
function host() {
  const events = { change: null, save: null };
  const document = { uri: { fsPath: '', toString() { return this.fsPath; } }, version: 1, isDirty: false, text: '', getText() { return this.text; }, positionAt(offset) { return offset; }, async save() { this.isDirty = false; events.save?.(this); return true; } };
  const opened = [], messages = [], disposables = [];
  let receive;
  const uri = value => ({ fsPath: value, toString: () => value });
  const api = {
    Uri: { file: uri, joinPath: (root, ...parts) => uri(path.join(root.fsPath, ...parts)) },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    WorkspaceEdit: class { replace(uri, range, text) { this.text = text; } },
    ViewColumn: { Beside: -2 },
    workspace: {
      isTrusted: true,
      textDocuments: [document],
      onDidChangeTextDocument(callback) { events.change = callback; return { dispose() {} }; },
      onDidSaveTextDocument(callback) { events.save = callback; return { dispose() {} }; },
      async applyEdit(edit) { document.text = edit.text; document.version++; document.isDirty = true; events.change?.({ document }); return true; },
      async openTextDocument(uri) { opened.push(uri); return { uri }; },
    },
    window: { async showTextDocument(doc, options) { opened.push(options); }, async showInputBox() { return 'Named model'; } },
  };
  const panel = { viewColumn: 1, webview: { cspSource: 'vscode-resource:', asWebviewUri: value => value.toString(), postMessage(message) { messages.push(message); }, onDidReceiveMessage(callback) { receive = callback; return { dispose() {} }; } }, onDidDispose(callback) { disposables.push(callback); } };
  const original = Module._load;
  let GraphProvider;
  try {
    Module._load = function(request, ...args) { return request === 'vscode' ? api : original.call(this, request, ...args); };
    delete require.cache[require.resolve('../src/extension.cjs')];
    ({ GraphProvider } = require('../src/extension.cjs'));
  } finally { Module._load = original; }
  return { api, document, panel, GraphProvider, opened, messages, events, receive: message => receive(message) };
}

test('custom editor persists edits, follows Undo, opens source beside graph, and saves code before run', async t => {
  const h = host();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-editor-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  h.document.uri.fsPath = path.join(dir, 'graph.lmg');
  h.document.text = '{"nodes":[],"edges":[],"custom":"keep"}';
  let ran = false;
  const runtime = { async run(project, id, mode, emit) {
    assert.equal(h.document.isDirty, false);
    assert.equal(codeSaved, true);
    assert.equal(mode, 'all');
    ran = true; emit({ kind: 'completed', success: true });
  } };
  const provider = new h.GraphProvider({ extensionUri: h.api.Uri.file(path.resolve(__dirname, '..')) }, runtime);
  await provider.resolveCustomTextEditor(h.document, h.panel);
  const session = provider.sessions.get(h.document.uri.toString());
  h.receive({ type: 'ready' });
  await provider.edit(session, { type: 'add' });
  assert.equal(h.document.isDirty, true);
  let graph = JSON.parse(h.document.text);
  assert.equal(graph.nodes[0].id, '1');
  assert.equal(graph.custom, 'keep');
  await provider.openNode(session, '1');
  assert.equal(h.opened[0].fsPath, await fs.realpath(path.join(dir, 'nodes/1.py')));
  assert.equal(h.opened[1].viewColumn, 2);
  assert.equal(h.opened[1].preserveFocus, true);
  let codeSaved = false;
  h.api.workspace.textDocuments.push({ uri: h.api.Uri.file(path.join(dir, 'nodes/1.py')), isDirty: true, async save() { codeSaved = true; return true; } });
  await provider.run(session, 'all');
  assert.equal(ran, true);
  // VS Code Undo changes the TextDocument; the graph must redraw from that source.
  h.document.text = '{"nodes":[],"edges":[]}'; h.document.version++;
  h.events.change({ document: h.document });
  assert.deepEqual(h.messages.at(-1).graph.nodes, []);
  await provider.edit(session, { type: 'add' });
  graph = JSON.parse(h.document.text);
  assert.equal(graph.nodes[0].id, '2'); // original source file retained after Undo
  assert.match(h.panel.webview.html, /default-src 'none'/);
});

test('edits refuse to overwrite a concurrently changed document', async t => {
  const h = host();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-conflict-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  h.document.uri.fsPath = path.join(dir, 'graph.lmg');
  h.document.text = '{"nodes":[{"id":"1","data":{"title":"Original","scriptPath":"nodes/1.py"}}],"edges":[]}';
  const provider = new h.GraphProvider({ extensionUri: h.api.Uri.file(dir) }, {});
  await provider.resolveCustomTextEditor(h.document, h.panel);
  h.api.window.showInputBox = async () => { h.document.version++; h.document.text = '{"nodes":[],"edges":[]}'; return 'new name'; };
  await assert.rejects(provider.edit(provider.sessions.get(h.document.uri.toString()), { type: 'rename', id: '1' }), /changed while editing/);
  assert.deepEqual(JSON.parse(h.document.text).nodes, []);
});

test('palette actions target the active graph and preserve existing requirements', async t => {
  const h = host();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-commands-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  h.document.uri.fsPath = path.join(dir, 'graph.lmg');
  h.document.text = '{"nodes":[],"edges":[]}';
  h.panel.active = true;
  const provider = new h.GraphProvider({ extensionUri: h.api.Uri.file(dir) }, {});
  await assert.rejects(provider.command('save'), /Open a Limulus graph/);
  await provider.resolveCustomTextEditor(h.document, h.panel);
  h.document.isDirty = true;
  await provider.command('save');
  assert.equal(h.document.isDirty, false);
  const requirements = path.join(dir, 'requirements.txt');
  await fs.writeFile(requirements, 'pandas==2.2.3\n');
  await provider.command('dependencies');
  assert.equal(await fs.readFile(requirements, 'utf8'), 'pandas==2.2.3\n');
  assert.equal(h.opened[0].fsPath, requirements);
  let called;
  provider.run = async (session, mode) => { called = { session, mode }; };
  await provider.command('installDependencies');
  assert.equal(called.session.document, h.document);
  assert.equal(called.mode, 'dependencies');
});
