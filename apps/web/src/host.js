import events from '@limulus/editor-core/events';

export async function request(operation, input = {}, options = {}) {
  const response = await fetch(`/api/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try { message = JSON.parse(text).error || text; } catch {}
    throw new Error(message);
  }
  return response.json();
}

// Same message contract as the VS Code bridge. The graph is canonical host state;
// React Flow selection, dimensions and execution statuses never get serialized.
export class WebHost {
  constructor(project, notify = () => {}, openSource = () => {}) {
    this.path = project.path; this.graph = project.graph;
    this.notify = notify; this.openSource = openSource;
    this.listeners = new Set(); this.queue = Promise.resolve();
    this.dirty = false; this.running = false; this.hasRun = false; this.history = []; this.future = [];
    this.drafts = new Map(); this.disposed = false;
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(message) { if (!this.disposed) for (const listener of this.listeners) listener(message); }
  snapshot() {
    this.emit({ type: 'graph', graph: this.graph, dirty: this.dirty });
    this.notify();
  }
  enqueue(operation) {
    const job = this.queue.then(() => { if (!this.disposed) return operation(); });
    this.queue = job.catch(error => { this.emit({ type: 'error', message: error.message }); this.snapshot(); });
    return job;
  }
  send(message) {
    if (message.type === 'ready') { this.snapshot(); return; }
    if (message.type === 'stop') { this.controller?.abort(); return; }
    // Running is managed outside the edit queue so Stop is always responsive.
    this.enqueue(async () => {
      switch (message.type) {
        case 'edit': await this.edit(message.action); break;
        case 'openNode': await this.showSource(message.id); break;
        case 'run': this.execution = this.run(message.mode, message.id); void this.execution.catch(error => this.emit({ type: 'error', message: error.message })); break;
        default: throw new Error('Unsupported editor message.');
      }
    }).catch(() => {});
  }
  assertEditable() { if (this.running) throw new Error('Stop execution before editing this project.'); }
  async edit(action) {
    this.assertEditable();
    if (action.type === 'rename') {
      const node = this.graph.nodes.find(node => node.id === action.id);
      const title = window.prompt('Node name', node?.data.title || '');
      if (title === null) return;
      action = { ...action, title };
    }
    if (action.type === 'remove' || action.type === 'rename') await this.flushSources();
    const { graph, saved } = await request('edit', { path: this.path, graph: this.graph, action });
    this.history.push(this.graph); this.future = []; this.graph = graph; this.dirty = !saved; this.snapshot();
    if (action.type === 'rename') await this.refreshSource();
  }
  async restore(from, to) {
    this.assertEditable();
    if (!from.length) return;
    await this.flushSources();
    const { graph, saved } = await request('restore', { path: this.path, graph: this.graph, target: from.at(-1) });
    to.push(this.graph); from.pop(); this.graph = graph; this.dirty = !saved; this.snapshot();
    await this.refreshSource();
  }
  undo() { return this.restore(this.history, this.future); }
  redo() { return this.restore(this.future, this.history); }
  async refreshSource() {
    if (!this.sourceId) return;
    if (this.sourceId !== 'requirements' && !this.graph.nodes.some(node => node.id === this.sourceId)) {
      this.sourceId = null; this.openSource(null); return;
    }
    await this.showSource(this.sourceId);
  }
  draft(source, code) { this.drafts.set(source.id, { ...source, code }); this.notify(); }
  async showSource(id) {
    const source = this.drafts.get(id) || await request(id === 'requirements' ? 'dependencies' : 'source', { path: this.path, graph: this.graph, id });
    this.sourceId = id; this.openSource(source);
  }
  async saveSource(id, preparing = false) {
    const draft = this.drafts.get(id);
    if (!draft) return;
    if (!preparing) this.assertEditable();
    await request(id === 'requirements' ? 'dependencies' : 'source', { path: this.path, graph: this.graph, id, code: draft.code });
    if (this.drafts.get(id) === draft) this.drafts.delete(id);
    this.notify();
  }
  async flushSources(preparing = false) { for (const id of this.drafts.keys()) await this.saveSource(id, preparing); }
  async save() {
    this.assertEditable(); await this.flushSources();
    const { graph } = await request('save', { path: this.path, graph: this.graph });
    this.graph = graph; this.dirty = false; this.snapshot();
  }
  async saveAs(destination) {
    this.assertEditable(); await this.flushSources();
    const result = await request('save-as', { path: this.path, destination, graph: this.graph });
    this.path = result.path; this.graph = result.graph; this.dirty = false; this.snapshot();
  }
  async run(mode, id) {
    if (this.running) throw new Error('This project is already running.');
    this.running = true; this.controller = new AbortController();
    this.emit({ type: 'running', value: true }); this.notify();
    try {
      await this.flushSources(true);
      this.controller.signal.throwIfAborted();
      const response = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.path, graph: this.graph, mode, id }), signal: this.controller.signal,
      });
      if (response.ok) { this.hasRun = true; this.dirty = false; this.snapshot(); }
      await events.readEvents(response, event => this.emit({ type: 'event', event }));
    } catch (error) {
      this.emit({ type: 'error', message: this.controller.signal.aborted ? 'Execution stopped.' : error.message });
    } finally {
      this.running = false; this.controller = null; this.emit({ type: 'running', value: false }); this.notify();
    }
  }
  async dispose() {
    this.disposed = true; this.controller?.abort(); this.listeners.clear();
    await this.queue;
    await this.execution?.catch(() => {});
    if (!this.hasRun) return;
    // Reset persistent universes when the project tab closes.
    try {
      await request('stop', { path: this.path });
      const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: this.path, graph: this.graph, mode: 'reset' }) });
      await events.readEvents(response, () => {});
    } catch { /* The page may be closing or the server may already be gone. */ }
  }
}
