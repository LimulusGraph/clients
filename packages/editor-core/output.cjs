// Output is data, never executable HTML supplied by a Python object.
function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderOutput(event) {
  const output = event.output;
  if (!output) return `<pre class="output-text">${escape(event.text || '')}</pre>`;
  if (output.kind === 'text') return `<pre class="output-text">${escape(output.text)}</pre>`;
  if (output.kind === 'image' && output.mime === 'image/png' && /^[A-Za-z0-9+/]+={0,2}$/.test(output.data || '')) {
    return `<figure class="output-figure"><img src="data:image/png;base64,${output.data}" alt="${escape(output.caption || 'Plot')}" /></figure>`;
  }
  if (output.kind === 'table') {
    const columns = Array.isArray(output.columns) ? output.columns : [];
    const rows = Array.isArray(output.rows) ? output.rows : [];
    return `<div class="output-table"><table><thead><tr><th scope="col"></th>${columns.map(c => `<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, i) => `<tr><th scope="row">${escape(output.index?.[i])}</th>${row.map(c => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="output-caption">${escape(output.total_rows)} rows × ${escape(output.total_columns)} columns${output.truncated ? ` · Showing first ${rows.length} rows and ${columns.length} columns` : ''}</p>`;
  }
  return '';
}
// Count UTF-16 storage conservatively, including image payloads.
function eventSize(event) { return JSON.stringify(event).length * 2; }
function appendOutput(events, event, budget = 20 * 1024 * 1024) {
  const next = [...events, event];
  let size = next.reduce((sum, e) => sum + eventSize(e), 0);
  while (next.length && (next.length > 2000 || size > budget)) size -= eventSize(next.shift());
  return next;
}
module.exports = { escape, renderOutput, appendOutput, eventSize };
