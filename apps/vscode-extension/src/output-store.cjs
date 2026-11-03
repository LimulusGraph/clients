const { createHash } = require('node:crypto');
const { eventSize } = require('./output-format.cjs');
const hash = source => createHash('sha256').update(source).digest('hex');
class OutputStore {
  constructor(budget = 20 * 1024 * 1024) { this.records = []; this.budget = budget; this.bytes = 0; }
  remove(predicate) {
    this.records = this.records.filter(record => !predicate(record));
    this.bytes = this.records.reduce((sum, record) => sum + record.size, 0);
  }
  clear(project) { this.remove(r => project === undefined || r.project === project); }
  record(project, event, sources, mode, routes) {
    if (event.kind === 'route_started') {
      routes.set(event.route_id, event.text);
      if (mode !== 'node_only') this.remove(r => r.project === project && r.event.route_id === event.route_id);
    }
    if (event.kind === 'node_started') this.remove(r => r.project === project && r.event.route_id === event.route_id && r.event.node_id === event.node_id);
    if (!['log', 'display'].includes(event.kind)) return;
    const source = sources.get(event.node_id);
    if (!source) return;
    const record = { project, event, filename: source.filename, hash: source.hash, route: routes.get(event.route_id) || event.route_id, size: eventSize(event) };
    this.records.push(record); this.bytes += record.size;
    while (this.records.length && (this.records.length > 2000 || this.bytes > this.budget)) this.bytes -= this.records.shift().size;
  }
  forFile(filename) { return this.records.filter(r => r.filename === filename); }
}
module.exports = { OutputStore, hash };
