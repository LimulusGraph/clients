const { defaultPython, venvPython } = require('@limulus/node-host/platform');
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function setup(parser) {
  const callbacks = {}, sent = [], shown = [];
  let receive, dispose, panel;
  const uri = filename => ({ fsPath: filename, path: filename, toString: () => filename });
  const document = { uri: uri('/tmp/experiment.py'), version: 1, isDirty: false, lineCount: 10, getText: () => '# # Original' };
  const disposable = { dispose() {} };
  const vscode = {
    ViewColumn: { Beside: -2 },
    Uri: { file: uri, joinPath: (root, ...rest) => uri(path.join(root.fsPath, ...rest)), parse: uri },
    Range: class { constructor(startLine, startColumn, endLine, endColumn) { Object.assign(this, { startLine, startColumn, endLine, endColumn }); } },
    workspace: {
      getConfiguration: () => ({ get: () => defaultPython() }),
      onDidChangeTextDocument: fn => { callbacks.change = fn; return disposable; },
      onDidSaveTextDocument: fn => { callbacks.save = fn; return disposable; },
      onDidOpenTextDocument: fn => { callbacks.open = fn; return disposable; },
      onDidChangeConfiguration: fn => { callbacks.config = fn; return disposable; },
      openTextDocument: async () => document,
    },
    window: {
      createWebviewPanel: () => panel = {
        webview: { cspSource: 'vscode-resource:', asWebviewUri: value => value, postMessage: message => sent.push(message), onDidReceiveMessage: fn => { receive = fn; return disposable; } },
        onDidDispose: fn => { dispose = fn; }, dispose: () => dispose(), reveal() {},
      },
      showTextDocument: async (doc, options) => shown.push(options),
    },
  };
  const original = Module._load;
  let exported;
  try {
    Module._load = function (request, ...args) { return request === 'vscode' ? vscode : original.call(this, request, ...args); };
    delete require.cache[require.resolve('../src/preview.cjs')];
    exported = require('../src/preview.cjs');
  } finally { Module._load = original; }
  const manager = new exported.PythonPreviewManager({ extensionUri: uri('/extension') }, parser);
  return { manager, document, callbacks, sent, shown, receive: message => receive(message), ...exported };
}
const result = title => ({ segments: [{ kind: 'markdown', text: `# ${title}`, startLine: 1, endLine: 1 }], warning: null });

test('preview updates unsaved text, reveals source lines, and cleans up', async () => {
  const sources = [];
  const h = setup(async source => { sources.push(source); return result(source.slice(4)); });
  await h.manager.show(h.document, 2, 1);
  await h.receive({ type: 'ready' });
  assert.match(h.sent.at(-1).html, /Original/);
  h.document.getText = () => '# # Edited'; h.document.version++; h.document.isDirty = true;
  h.callbacks.change({ document: h.document });
  await new Promise(resolve => setTimeout(resolve, 240));
  assert.equal(sources.at(-1), '# # Edited');
  assert.equal(h.sent.at(-1).dirty, true);
  await h.receive({ type: 'source', line: 5 });
  assert.equal(h.shown[0].selection.startLine, 4);
  assert.equal(h.shown[0].viewColumn, 1);
  h.manager.dispose();
  assert.equal(h.manager.previews.size, 0);
});

test('stale parse results do not overwrite newer source', async () => {
  const jobs = [];
  const h = setup(() => new Promise(resolve => jobs.push(resolve)));
  await h.manager.show(h.document);
  const old = h.receive({ type: 'ready' });
  h.document.version++;
  const recent = h.receive({ type: 'ready' });
  jobs[1](result('New')); await recent;
  jobs[0](result('Old')); await old;
  const previews = h.sent.filter(message => message.type === 'preview');
  assert.equal(previews.length, 1);
  assert.match(previews[0].html, /New/);
  h.manager.dispose();
});

test('local asset paths cannot leave the source directory', () => {
  const { localAsset } = setup();
  const base = path.resolve('/project');
  assert.equal(localAsset(base, 'plots/plot.png'), path.join(base, 'plots', 'plot.png'));
  for (const value of ['../secret', '%2e%2e/secret', '/tmp/x', 'command:foo', 'file:///tmp/x', 'a\\b']) assert.equal(localAsset(base, value), null);
});


test('source preview shows retained output, source changes and reset', async () => {
  const { hash } = require('../src/output-store.cjs');
  const h = setup(async () => result('Source'));
  const sources = new Map([['1', { filename: h.document.uri.fsPath, hash: hash(h.document.getText()) }]]);
  const routes = new Map([['route', '1 → 2']]);
  h.manager.recordOutput('/project/graph.lmg', { kind: 'log', node_id: '1', route_id: 'route', line: 3, text: '<hello>' }, sources, 'all', routes);
  await h.manager.show(h.document);
  await h.receive({ type: 'ready' });
  const output = () => h.sent.filter(m => m.type === 'outputs').at(-1);
  assert.match(output().groups[0].html, /&lt;hello&gt;/);
  assert.match(output().groups[0].label, /Node #1/);
  assert.doesNotMatch(output().groups[0].html, /Source changed/);
  h.document.getText = () => 'changed'; h.document.version++;
  h.callbacks.change({ document: h.document });
  assert.match(output().groups[0].html, /Source changed/);
  h.manager.clearOutputs('/project/graph.lmg');
  assert.equal(output().groups.length, 0);
  h.manager.dispose();
});
