const { defaultPython } = require('@limulus/node-host/platform');
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const { OutputStore, hash } = require('./output-store.cjs');
const { renderOutput } = require('./output-format.cjs');
const { parsePython, renderPreview } = require('./markdown.cjs');

function localAsset(base, value) {
  // Decode before containment checks; do not interpret absolute paths or URI schemes.
  let relative;
  try { relative = decodeURIComponent(value.split(/[?#]/, 1)[0]); } catch { return null; }
  if (!relative || /[\\\0]/.test(relative) || /^[a-z][a-z\d+.-]*:/i.test(relative) || path.isAbsolute(relative)) return null;
  const filename = path.resolve(base, relative);
  const distance = path.relative(base, filename);
  if (distance === '..' || distance.startsWith(`..${path.sep}`) || path.isAbsolute(distance)) return null;
  return filename;
}

class PythonPreviewManager {
  constructor(context, parser = parsePython) {
    this.context = context;
    this.parser = parser;
    this.previews = new Map();
    this.outputs = new OutputStore();
    this.outputTimer = null;
  }
  clearOutputs(project) { this.outputs.clear(project); this.refreshOutputs(); }
  refreshOutputs() { for (const state of this.previews.values()) state.sendOutputs?.(); }
  recordOutput(project, event, sources, mode, routes) {
    this.outputs.record(project, event, sources, mode, routes);
    // Coalesce streaming updates without delaying source edits or reset feedback.
    if (!this.outputTimer) this.outputTimer = setTimeout(() => {
      this.outputTimer = null;
      this.refreshOutputs();
    }, 100);
  }
  async show(document, column = vscode.ViewColumn.Beside, sourceColumn) {
    if (!document || !document.uri.path.toLowerCase().endsWith('.py')) throw new Error('Open a Python file to preview its Markdown comments.');
    const key = document.uri.toString();
    const existing = this.previews.get(key);
    if (existing) { existing.panel.reveal(column, true); existing.schedule(); return; }
    const panel = vscode.window.createWebviewPanel('limulus.pythonPreview', `Preview · ${path.basename(document.uri.fsPath)}`, { viewColumn: column, preserveFocus: true }, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.file(path.dirname(document.uri.fsPath))],
    });
    const nonce = randomBytes(24).toString('hex');
    const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'preview.css'));
    const js = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'preview.js'));
    const state = { panel, document, sourceColumn, timer: null, controller: null, generation: 0, disposed: false, links: [], revision: 0 };
    this.previews.set(key, state);
    const send = message => { if (!state.disposed) void panel.webview.postMessage(message); };
    state.sendOutputs = () => {
      const records = this.outputs.forFile(state.document.uri.fsPath);
      const groups = new Map();
      for (const record of records) {
        const groupKey = JSON.stringify([record.project, record.event.node_id, record.event.route_id]);
        if (!groups.has(groupKey)) groups.set(groupKey, { record, events: [] });
        groups.get(groupKey).events.push(record.event);
      }
      const currentHash = hash(state.document.getText());
      send({ type: 'outputs', groups: [...groups].map(([id, { record, events }]) => ({
        id, label: `${path.basename(record.project)} · Node #${record.event.node_id} · ${record.route} (${record.event.route_id?.slice(0, 6)})`,
        html: `${record.hash !== currentHash ? '<p class="output-stale">Source changed since execution. Run again to refresh these results.</p>' : ''}${events.map(event => `<div class="output-entry ${event.source === 'stderr' ? 'stderr' : ''}">${event.line ? `<button class="output-line" data-line="${Number(event.line)}">Line ${Number(event.line)}</button>` : ''}${renderOutput(event)}</div>`).join('')}`,
      })) });
    };
    const update = async () => {
      const generation = ++state.generation;
      state.controller?.abort();
      const controller = state.controller = new AbortController();
      const doc = state.document;
      const version = doc.version;
      try {
        const python = vscode.workspace.getConfiguration('limulus', doc.uri).get('pythonPath', '') || defaultPython();
        const parsed = await this.parser(doc.getText(), { python, signal: controller.signal });
        if (state.disposed || controller.signal.aborted || generation !== state.generation || version !== state.document.version) return;
        const directory = path.dirname(doc.uri.fsPath);
        const rendered = renderPreview(parsed, { imageUri: value => {
          if (/^https:\/\//i.test(value) || /^data:image\/(?:png|gif|jpeg|webp);base64,/i.test(value)) return value;
          const filename = localAsset(directory, value);
          return filename ? panel.webview.asWebviewUri(vscode.Uri.file(filename)).toString() : null;
        } });
        state.links = rendered.links;
        state.revision++;
        state.sendOutputs();
        send({ type: 'preview', html: rendered.html, warning: parsed.warning, filename: path.basename(doc.uri.fsPath), dirty: doc.isDirty, revision: state.revision });
      } catch (error) {
        if (!controller.signal.aborted && !state.disposed && generation === state.generation) send({ type: 'error', message: error.message });
      }
    };
    const schedule = () => {
      state.sendOutputs();
      clearTimeout(state.timer);
      state.controller?.abort();
      state.timer = setTimeout(update, 180);
    };
    state.schedule = schedule;
    const changed = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === key) { state.document = event.document; schedule(); }
    });
    const saved = vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.uri.toString() === key) { state.document = doc; schedule(); }
    });
    const opened = vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.uri.toString() === key) { state.document = doc; schedule(); }
    });
    const configuration = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('limulus.pythonPath', state.document.uri)) schedule();
    });
    const messages = panel.webview.onDidReceiveMessage(async message => {
      try {
        if (state.disposed) return;
        if (message?.type === 'ready') { await update(); return; }
        if (message?.type === 'source') {
          const doc = await vscode.workspace.openTextDocument(state.document.uri);
          state.document = doc;
          const line = Math.min(Math.max(Number.isInteger(message.line) ? message.line - 1 : 0, 0), doc.lineCount - 1);
          const selection = new vscode.Range(line, 0, line, 0);
          await vscode.window.showTextDocument(doc, { viewColumn: state.sourceColumn || vscode.ViewColumn.Beside, selection, preview: false });
        } else if (message?.type === 'link' && message.revision === state.revision && Number.isInteger(message.index)) {
          const target = state.links[message.index];
          if (!target) return;
          if (/^(?:https?:|mailto:)/i.test(target)) {
            await vscode.env.openExternal(vscode.Uri.parse(target));
          } else {
            const directory = await fs.realpath(path.dirname(state.document.uri.fsPath));
            const filename = localAsset(directory, target);
            if (!filename) throw new Error('This link is not a supported web URL or a file in the source folder.');
            const real = await fs.realpath(filename);
            const relative = path.relative(directory, real);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('This link points outside the source folder.');
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(real));
            await vscode.window.showTextDocument(doc, { viewColumn: state.sourceColumn || vscode.ViewColumn.Beside });
          }
        }
      } catch (error) { send({ type: 'error', message: error.message }); }
    });
    panel.onDidDispose(() => {
      state.disposed = true;
      clearTimeout(state.timer); state.controller?.abort();
      changed.dispose(); saved.dispose(); opened.dispose(); configuration.dispose(); messages.dispose();
      this.previews.delete(key);
    });
    panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} https: data:; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body><header><strong id="filename">Python preview</strong><span>Live · Python with Markdown blocks</span><button id="source">Edit source</button></header><div id="notice" role="status" hidden></div><article id="content">Loading preview…</article><section id="execution"><h2>Execution output</h2><select id="universe" aria-label="Output universe"></select><div id="results"><p>Run this node from the graph to see its output.</p></div></section><script nonce="${nonce}" src="${js}"></script></body></html>`;
  }
  dispose() { clearTimeout(this.outputTimer); for (const state of [...this.previews.values()]) state.panel.dispose(); }
}
module.exports = { PythonPreviewManager, localAsset };
