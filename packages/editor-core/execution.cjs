// Runtime state is deliberately separate from the persisted graph document.
function applyEvent(statuses, event) {
  if (!event.node_id || !['node_started', 'node_finished'].includes(event.kind)) return;
  const routes = statuses.get(event.node_id) || new Map();
  routes.set(event.route_id, event.kind === 'node_started' ? 'running' : event.success ? 'success' : 'error');
  statuses.set(event.node_id, routes);
}
function statusFor(statuses, id) {
  const values = [...(statuses.get(id)?.values() || [])];
  return values.includes('running') ? 'running' : values.includes('error') ? 'error' : values.length ? 'success' : '';
}
module.exports = { applyEvent, statusFor };
