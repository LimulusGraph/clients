const vscode = acquireVsCodeApi();
const content = document.getElementById('content');
const notice = document.getElementById('notice');
let revision = 0;
let outputGroups = [];
const universe = document.getElementById('universe');
const results = document.getElementById('results');
function renderResults() {
  const group = outputGroups.find(g => g.id === universe.value);
  results.innerHTML = group?.html || '<p>Run this node from the graph to see its output.</p>';
}
universe.addEventListener('change', renderResults);
results.addEventListener('click', event => {
  const source = event.target.closest('[data-line]');
  if (source) vscode.postMessage({ type: 'source', line: Number(source.dataset.line) });
});
const showNotice = text => { notice.textContent = text || ''; notice.hidden = !text; };
document.getElementById('source').addEventListener('click', () => vscode.postMessage({ type: 'source', line: 1 }));
content.addEventListener('click', event => {
  const source = event.target.closest('[data-line]');
  if (source) { vscode.postMessage({ type: 'source', line: Number(source.dataset.line) }); return; }
  const link = event.target.closest('a[data-link]');
  if (link) {
    event.preventDefault();
    const index = Number(link.dataset.link);
    // Anchor navigation stays inside the preview. All other links go through VS Code.
    const anchor = link.dataset.anchor;
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
    else vscode.postMessage({ type: 'link', index, revision });
  }
});
window.addEventListener('message', ({ data: message }) => {
  if (message.type === 'outputs') {
    const selected = universe.value;
    outputGroups = message.groups;
    universe.replaceChildren(...outputGroups.map(group => {
      const option = document.createElement('option'); option.value = group.id; option.textContent = group.label; return option;
    }));
    if (outputGroups.some(group => group.id === selected)) universe.value = selected;
    universe.hidden = !outputGroups.length;
    renderResults(); return;
  }
  if (message.type === 'error') { showNotice(message.message); return; }
  if (message.type !== 'preview') return;
  const offset = window.scrollY;
  revision = message.revision;
  document.getElementById('filename').textContent = message.filename + (message.dirty ? ' • unsaved' : '');
  // Source HTML is produced by the host renderer with raw Markdown HTML disabled.
  content.innerHTML = message.html;
  showNotice(message.warning);
  window.scrollTo(0, offset);
});
vscode.postMessage({ type: 'ready' });
