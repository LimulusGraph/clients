import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import GraphEditor from '@limulus/editor-ui';
import '@limulus/editor-ui/style.css';
import './style.css';
import { WebHost, request } from './host.js';

function Project({ host, active }) {
  const [source, setSource] = useState(null);
  host.openSource = setSource;
  return <div className="project" hidden={!active}>
    <div className="canvas"><GraphEditor host={host} /></div>
    {source && <aside className="source-pane">
      <header><strong>{source.title || source.id}{host.drafts.has(source.id) ? ' •' : ''}</strong><span className="spacer" />
        <button disabled={host.running} onClick={() => host.enqueue(() => host.saveSource(source.id)).catch(() => {})}>Save source</button>
        <button onClick={() => { host.sourceId = null; setSource(null); }} aria-label="Close source editor">×</button>
      </header>
      <small className="source-path">{source.filename}</small>
      <textarea aria-label="Source code" spellCheck={false} value={source.code} readOnly={host.running}
        onChange={event => { const next = { ...source, code: event.target.value }; setSource(next); host.draft(next, next.code); }} />
      <small className="source-path">Source changes are saved before execution. Closing this pane keeps your draft.</small>
    </aside>}
  </div>;
}
function App() {
  const [tabs, setTabs] = useState([]), [activeId, setActiveId] = useState(null);
  const [error, setError] = useState(''), [palette, setPalette] = useState(false), [query, setQuery] = useState('');
  const [, redraw] = useState(0);
  const nextId = useRef(1), currentTabs = useRef(tabs); currentTabs.current = tabs;
  const active = tabs.find(tab => tab.id === activeId)?.host;
  const handle = operation => Promise.resolve().then(operation).catch(error => setError(error.message));
  const addProject = project => {
    const existing = currentTabs.current.find(tab => tab.host.path === project.path);
    if (existing) { setActiveId(existing.id); return; }
    const id = nextId.current++;
    const host = new WebHost(project, () => redraw(value => value + 1));
    setTabs(old => [...old, { id, host }]); setActiveId(id);
  };
  const create = async () => addProject(await request('new'));
  const open = async () => {
    const path = window.prompt('Open a local .lmg project:');
    if (path?.trim()) addProject(await request('open', { path: path.trim() }));
  };
  const saveAs = () => {
    const destination = window.prompt('Save to a new .lmg path:', active.path);
    if (destination?.trim()) return active.enqueue(() => active.saveAs(destination.trim()));
  };
  const close = async tab => {
    if ((tab.host.dirty || tab.host.drafts.size) && !window.confirm('Close this project and discard unsaved changes?')) return;
    await tab.host.dispose();
    const remaining = currentTabs.current.filter(item => item.id !== tab.id);
    setTabs(remaining);
    if (activeId === tab.id) setActiveId(remaining[0]?.id ?? null);
  };
  const commands = [
    { label: 'New Graph', action: create }, { label: 'Open Graph…', action: open },
    { label: 'Save Graph', action: () => active.enqueue(() => active.save()), disabled: !active || active.running },
    { label: 'Save As…', action: saveAs, disabled: !active || active.running },
    { label: 'New Node', action: () => active.send({ type: 'edit', action: { type: 'add' } }), disabled: !active || active.running },
    { label: 'Undo', action: () => active.enqueue(() => active.undo()), disabled: !active || active.running },
    { label: 'Redo', action: () => active.enqueue(() => active.redo()), disabled: !active || active.running },
    { label: 'Edit Dependencies', action: () => active.enqueue(() => active.showSource('requirements')), disabled: !active || active.running },
    { label: 'Install Dependencies', action: () => active.send({ type: 'run', mode: 'dependencies' }), disabled: !active || active.running },
  ];
  useEffect(() => {
    let disposed = false;
    request('new').then(project => { if (!disposed) addProject(project); }).catch(error => setError(error.message));
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    const beforeUnload = event => {
      if (currentTabs.current.some(tab => tab.host.dirty || tab.host.drafts.size || tab.host.running)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useEffect(() => {
    const key = event => {
      if (event.key === 'Escape') { setPalette(false); return; }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey && key === 'p') { event.preventDefault(); setQuery(''); setPalette(value => !value); }
      if (key === 's' && active) { event.preventDefault(); handle(event.shiftKey ? saveAs : () => active.enqueue(() => active.save())); }
      if (key === 'z' && active && !['TEXTAREA', 'INPUT'].includes(event.target.tagName)) {
        event.preventDefault(); handle(() => active.enqueue(() => event.shiftKey ? active.redo() : active.undo()));
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  return <div className="web-app">
    <header className="web-menu"><strong>Limulus</strong><button onClick={() => handle(create)}>New</button><button onClick={() => handle(open)}>Open…</button>
      <button disabled={!active || active.running} onClick={() => handle(() => active.enqueue(() => active.save()))}>Save</button>
      <button disabled={!active || active.running} onClick={() => handle(saveAs)}>Save As…</button>
      <span className="spacer" /><button onClick={() => { setQuery(''); setPalette(true); }}>Commands ⌘/Ctrl ⇧ P</button>
    </header>
    {error && <div role="alert" className="error">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    <nav className="tabs" aria-label="Projects">{tabs.map(tab => <div key={tab.id} className={tab.id === activeId ? 'tab active' : 'tab'}>
      <button onClick={() => setActiveId(tab.id)} title={tab.host.path}>{tab.host.path.split(/[\\/]/).pop()}{tab.host.dirty || tab.host.drafts.size ? ' •' : ''}{tab.host.running ? ' ▶' : ''}</button>
      <button aria-label={`Close ${tab.host.path.split(/[\\/]/).pop()}`} onClick={() => handle(() => close(tab))}>×</button>
    </div>)}</nav>
    {tabs.map(tab => <Project key={tab.id} host={tab.host} active={tab.id === activeId} />)}
    {!tabs.length && <div className="welcome"><h1>Limulus</h1><p>Create or open a graph to start a universe.</p><button onClick={() => handle(create)}>New graph</button></div>}
    {palette && <div className="palette-overlay" onClick={() => setPalette(false)}><section role="dialog" aria-modal="true" aria-label="Command palette" className="palette" onClick={event => event.stopPropagation()}>
      <input autoFocus aria-label="Find command" placeholder="Type a command…" value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { const command = commands.find(command => !command.disabled && command.label.toLowerCase().includes(query.toLowerCase())); if (command) { setPalette(false); handle(command.action); } } }} />
      {commands.filter(command => command.label.toLowerCase().includes(query.toLowerCase())).map(command => <button key={command.label} disabled={command.disabled} onClick={() => { setPalette(false); handle(command.action); }}>{command.label}</button>)}
    </section></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
