const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const { Runtime } = require('./runtime.cjs');
const { PythonPreviewManager } = require('./preview.cjs');
const { parseGraph, ensureSource, addNode, mutateGraph } = require('./graph.cjs');

let runtime;
let provider;
let previews;
function trusted() { if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Limulus.'); }

class GraphProvider {
  constructor(context, manager, previewManager) { this.context = context; this.runtime = manager; this.previews = previewManager; this.sessions = new Map(); }
  async resolveCustomTextEditor(document, panel) {
    const session = { document, panel, queue: Promise.resolve(), controller: null, disposed: false };
    this.sessions.set(document.uri.toString(), session);
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'graph.js'));
    const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'graph.css'));
    const nonce = randomBytes(24).toString('hex');
    panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const send = message => { if (!session.disposed) void panel.webview.postMessage(message); };
    session.send = send;
    const update = () => {
      try { send({ type: 'graph', graph: parseGraph(document.getText()), version: document.version, dirty: document.isDirty }); }
      catch (error) { send({ type: 'invalid', message: `Cannot display this graph: ${error.message}. Use “Reopen Editor With… → Text Editor” to repair it.` }); }
    };
    session.update = update;
    const changed = vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.toString() === document.uri.toString()) update(); });
    const saved = vscode.workspace.onDidSaveTextDocument(doc => { if (doc.uri.toString() === document.uri.toString()) update(); });
    const messages = panel.webview.onDidReceiveMessage(message => {
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'ready') { update(); return; }
      if (message.type === 'stop') { session.controller?.abort(); return; }
      // Serial edits patch the current document, rather than overwriting it with a stale graph.
      session.queue = session.queue.then(async () => {
        if (session.disposed) return;
        trusted();
        switch (message.type) {
          case 'edit': await this.edit(session, message.action); break;
          case 'openNode': await this.openNode(session, message.id); break;
          case 'previewNode': await this.previewNode(session, message.id); break;
          case 'run': this.run(session, message.mode, message.id).catch(error => send({ type: 'error', message: error.message })); break;
          default: throw new Error('Unsupported editor message.');
        }
      }).catch(error => { send({ type: 'error', message: error.message }); update(); });
    });
    panel.onDidDispose(() => {
      session.disposed = true;
      session.controller?.abort();
      changed.dispose(); saved.dispose(); messages.dispose();
      this.sessions.delete(document.uri.toString());
      this.previews?.clearOutputs(document.uri.fsPath);
      // Do not launch a server just to clean up a graph that has never run.
      if (this.runtime.endpoint) void this.runtime.run(document.uri.fsPath, '', 'reset', () => {}).catch(() => {});
    });
  }
  async command(action) {
    trusted();
    const sessions = [...this.sessions.values()].filter(session => !session.disposed);
    let session = sessions.find(session => session.panel.active);
    if (!session && sessions.length === 1) session = sessions[0];
    if (!session && sessions.length > 1) {
      const choice = await vscode.window.showQuickPick(sessions.map(session => ({
        label: path.basename(session.document.uri.fsPath), description: session.document.uri.fsPath, session,
      })), { placeHolder: 'Choose a Limulus graph' });
      session = choice?.session;
      if (!session) return;
    }
    if (!session) throw new Error('Open a Limulus graph before using this command.');
    const operation = session.queue.then(async () => {
      if (session.disposed) throw new Error('The graph was closed. Open it and try again.');
      if (action === 'save') {
        if (!await session.document.save()) throw new Error('Graph could not be saved.');
      } else if (action === 'dependencies') {
        const filename = path.join(path.dirname(session.document.uri.fsPath), 'requirements.txt');
        try { await fs.writeFile(filename, '# Project dependencies, one per line. Example: pandas>=2.0\n', { flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(filename)), { viewColumn: vscode.ViewColumn.Beside });
      } else if (action === 'installDependencies') {
        await this.run(session, 'dependencies');
      } else throw new Error('Unsupported graph command.');
    });
    session.queue = operation.catch(() => {});
    return operation;
  }
  async edit(session, action) {
    if (session.controller) throw new Error('Stop execution before editing the graph.');
    if (!action || typeof action.type !== 'string') throw new Error('Invalid graph edit.');
    const doc = session.document, version = doc.version;
    const graph = parseGraph(doc.getText());
    if (action.type === 'add') {
      const count = graph.nodes.length;
      await addNode(graph, doc.uri.fsPath, { x: 80 + (count % 5) * 60, y: 80 + (count % 5) * 60 });
    } else if (action.type === 'rename') {
      const node = graph.nodes.find(n => n.id === action.id);
      if (!node) throw new Error('Node no longer exists.');
      const title = await vscode.window.showInputBox({ prompt: `Name for node ${node.id}`, value: node.data.title || `Node ${node.id}`, validateInput: value => value.trim() ? undefined : 'Enter a name.' });
      if (title === undefined) return;
      mutateGraph(graph, { ...action, title });
    } else mutateGraph(graph, action);
    if (doc.version !== version) throw new Error('The graph changed while editing. Please try again.');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), JSON.stringify(graph, null, 2) + '\n');
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code could not apply the graph edit.');
    session.update();
  }
  async openNode(session, id) {
    const node = parseGraph(session.document.getText()).nodes.find(n => n.id === id);
    if (!node) throw new Error('Node no longer exists.');
    const filename = await ensureSource(session.document.uri.fsPath, node);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
    // Keep the graph visible and focused; reuse the neighboring editor group.
    const column = session.panel.viewColumn ? session.panel.viewColumn + 1 : vscode.ViewColumn.Beside;
    await vscode.window.showTextDocument(doc, { viewColumn: column, preview: true, preserveFocus: true });
  }
  async previewNode(session, id) {
    const node = parseGraph(session.document.getText()).nodes.find(n => n.id === id);
    if (!node) throw new Error('Node no longer exists.');
    const filename = await ensureSource(session.document.uri.fsPath, node);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
    await this.previews.show(document, session.panel.viewColumn ? session.panel.viewColumn + 1 : vscode.ViewColumn.Beside);
  }
  async run(session, mode, id) {
    if (session.controller) throw new Error('This graph is already running.');
    if (!['all', 'upstream', 'node_only', 'reset', 'dependencies'].includes(mode)) throw new Error('Invalid execution mode.');
    const controller = new AbortController();
    session.controller = controller;
    session.send({ type: 'running', value: true, mode });
    try {
      const version = session.document.version;
      const graph = parseGraph(session.document.getText());
      if (!['all', 'reset', 'dependencies'].includes(mode) && !graph.nodes.some(n => n.id === id)) throw new Error('Select a node first.');
      const outputSources = new Map();
      if (mode !== 'reset') {
        const sources = new Set();
        for (const node of graph.nodes) sources.add(await ensureSource(session.document.uri.fsPath, node));
        sources.add(path.join(path.dirname(session.document.uri.fsPath), 'requirements.txt'));
        // Execute precisely the code visible in VS Code, including unsaved edits.
        for (const doc of vscode.workspace.textDocuments) {
          if (!doc.isDirty) continue;
          const filename = await fs.realpath(doc.uri.fsPath).catch(() => doc.uri.fsPath);
          if (sources.has(filename) && !await doc.save()) throw new Error(`Could not save ${doc.fileName}.`);
        }
      }
      if (session.document.version !== version) throw new Error('The graph changed while preparing execution. Please run it again.');
      if (!await session.document.save()) throw new Error('Could not save the graph before execution.');
      controller.signal.throwIfAborted();
      if (this.previews && mode !== 'reset') {
        const { hash } = require('./output-store.cjs');
        for (const node of graph.nodes) {
          const filename = await ensureSource(session.document.uri.fsPath, node);
          outputSources.set(node.id, { filename, hash: hash(await fs.readFile(filename, 'utf8')) });
        }
      }
      if (mode === 'all' || mode === 'reset' || mode === 'dependencies') this.previews?.clearOutputs(session.document.uri.fsPath);
      const routes = new Map();
      await this.runtime.run(session.document.uri.fsPath, id, mode, event => {
        this.previews?.recordOutput(session.document.uri.fsPath, event, outputSources, mode, routes);
        session.send({ type: 'event', event });
      }, controller.signal);
    } catch (error) {
      session.send({ type: 'error', message: controller.signal.aborted ? 'Execution stopped.' : error.message });
    } finally {
      session.controller = null;
      session.send({ type: 'running', value: false });
    }
  }
  abortAll() { for (const session of this.sessions.values()) session.controller?.abort(); }
}

async function activate(context) {
  const output = vscode.window.createOutputChannel('Limulus');
  context.subscriptions.push(output);
  const config = () => {
    const settings = vscode.workspace.getConfiguration('limulus');
    return { serverPath: settings.get('serverPath'), pythonPath: settings.get('pythonPath') };
  };
  runtime = new Runtime(context.extensionPath, config, output);
  previews = new PythonPreviewManager(context);
  context.subscriptions.push(previews);
  provider = new GraphProvider(context, runtime, previews);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('limulus.graph', provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }));
  for (const [id, action] of [['limulus.saveGraph', 'save'], ['limulus.dependencies', 'dependencies'], ['limulus.installDependencies', 'installDependencies']]) {
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      try { await provider.command(action); }
      catch (error) { vscode.window.showErrorMessage(error.message); }
    }));
  }
  context.subscriptions.push(vscode.commands.registerCommand('limulus.previewPython', async uri => {
    try {
      const active = vscode.window.activeTextEditor;
      const target = uri?.path ? uri : active?.document.uri;
      if (!target) throw new Error('Open a Python file to preview its Markdown comments.');
      const document = await vscode.workspace.openTextDocument(target);
      await previews.show(document, vscode.ViewColumn.Beside, active?.document.uri.toString() === target.toString() ? active.viewColumn : undefined);
    } catch (error) { vscode.window.showErrorMessage(error.message); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('limulus.showOutput', () => output.show()));
  context.subscriptions.push(vscode.commands.registerCommand('limulus.restartServer', async () => {
    try { trusted(); provider.abortAll(); await runtime.stop(); previews.clearOutputs(); await runtime.start(); vscode.window.showInformationMessage('Limulus server restarted. Universe runtimes were reset.'); }
    catch (error) { vscode.window.showErrorMessage(error.message); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('limulus.openGraph', async () => {
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Limulus Graph': ['lmg'] } });
    if (files?.[0]) await vscode.commands.executeCommand('vscode.openWith', files[0], 'limulus.graph');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('limulus.newGraph', async () => {
    try {
      trusted();
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uri = await vscode.window.showSaveDialog({ defaultUri: folder ? vscode.Uri.joinPath(folder, 'experiment.lmg') : undefined, filters: { 'Limulus Graph': ['lmg'] } });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify({ nextNodeId: 1, nodes: [], edges: [] }, null, 2) + '\n'));
      await vscode.commands.executeCommand('vscode.openWith', uri, 'limulus.graph');
    } catch (error) { vscode.window.showErrorMessage(error.message); }
  }));
  const autoStart = async () => {
    if (!vscode.workspace.isTrusted || !vscode.workspace.getConfiguration('limulus').get('autoStart', true)) return;
    if (!(await vscode.workspace.findFiles('**/*.lmg', '**/{node_modules,.git}/**', 1)).length) return;
    try { await runtime.start(); } catch (error) { output.appendLine(error.message); vscode.window.showErrorMessage(`Limulus: ${error.message}`); }
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.lmg');
  context.subscriptions.push(watcher, watcher.onDidCreate(autoStart), vscode.workspace.onDidChangeWorkspaceFolders(autoStart), vscode.workspace.onDidGrantWorkspaceTrust(autoStart));
  void autoStart();
}
async function deactivate() { provider?.abortAll(); await runtime?.dispose(); }
module.exports = { activate, deactivate, GraphProvider };
