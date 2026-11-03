import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position, applyNodeChanges, applyEdgeChanges } from 'reactflow';
import 'reactflow/dist/style.css';
import './style.css';
import outputFormat from '@limulus/editor-core/output';
import execution from '@limulus/editor-core/execution';
const { renderOutput, appendOutput } = outputFormat;


function Node({ id, data, selected }) {
  return <div className={`node ${selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} id="in" />
    <div className="node-heading"><span className={`status ${data.runtimeStatus || ''}`} /><strong>{data.title || `Node ${id}`}</strong></div>
    <div className="node-meta">#{id} · {data.scriptPath || 'No source file'}</div>
    <Handle type="source" position={Position.Right} id="out" />
  </div>;
}
const nodeTypes = { custom: Node };

export default function GraphEditor({ host }) {
  const post = message => host.send(message);
  const [nodes, setNodes] = useState([]), [edges, setEdges] = useState([]);
  const [selected, setSelected] = useState(null), [running, setRunning] = useState(false);
  const [error, setError] = useState(''), [invalid, setInvalid] = useState(false);
  const [dirty, setDirty] = useState(false), [logs, setLogs] = useState([]);
  const [routeFilter, setRouteFilter] = useState(''), [routes, setRoutes] = useState({});
  const [nodeFilter, setNodeFilter] = useState('');
  const statuses = useRef(new Map());
  const selectedRef = useRef(null);
  const nodesRef = useRef(nodes), edgesRef = useRef(edges);
  nodesRef.current = nodes; edgesRef.current = edges;
  const statusFor = id => {
    return execution.statusFor(statuses.current, id);
  };
  useEffect(() => {
    const receive = message => {
      if (message.type === 'graph') {
        setInvalid(false); setDirty(message.dirty);
        setNodes(previous => message.graph.nodes.map(node => ({ ...node, type: 'custom', selected: previous.some(n => n.id === node.id && n.selected), data: { ...node.data, runtimeStatus: statusFor(node.id) } })));
        setEdges(message.graph.edges.map(edge => {
          const disabled = edge.data?.disabled === true || String(edge.style?.stroke || '').includes('0.3');
          return { ...edge, type: 'default', style: { ...edge.style, stroke: disabled ? '#888' : 'var(--lm-accent)', strokeWidth: 2, strokeDasharray: disabled ? '6 4' : undefined } };
        }));
        if (selectedRef.current && !message.graph.nodes.some(n => n.id === selectedRef.current)) { selectedRef.current = null; setSelected(null); }
      } else if (message.type === 'invalid') { setInvalid(true); setError(message.message); }
      else if (message.type === 'error') setError(message.message);
      else if (message.type === 'running') {
        setRunning(message.value);
        if (message.value) {
          statuses.current.clear(); setLogs([]); setRoutes({}); setRouteFilter(''); setError('');
          setNodes(old => old.map(n => ({ ...n, data: { ...n.data, runtimeStatus: '' } })));
        } else {
          setNodes(old => old.map(n => ({ ...n, data: { ...n.data, runtimeStatus: n.data.runtimeStatus === 'running' ? 'error' : n.data.runtimeStatus } })));
        }
      } else if (message.type === 'event') {
        const event = message.event;
        if (event.kind === 'route_started') setRoutes(old => ({ ...old, [event.route_id]: event.text }));
        if (event.node_id && ['node_started', 'node_finished'].includes(event.kind)) {
          execution.applyEvent(statuses.current, event);
          setNodes(old => old.map(n => n.id === event.node_id ? { ...n, data: { ...n.data, runtimeStatus: statusFor(n.id) } } : n));
        }
        if (event.kind === 'completed' && !event.success) setError(event.text);
        setLogs(old => appendOutput(old, event));
      }
    };
    const unsubscribe = host.subscribe(receive);
    post({ type: 'ready' });
    return unsubscribe;
  }, [host]);
  const edit = action => { setError(''); post({ type: 'edit', action }); };
  const removeSelected = () => edit({ type: 'remove', nodeIds: nodesRef.current.filter(n => n.selected).map(n => n.id), edgeIds: edgesRef.current.filter(e => e.selected).map(e => e.id) });
  const onNodesChange = useCallback(changes => setNodes(old => applyNodeChanges(changes.filter(c => c.type !== 'remove'), old)), []);
  const onEdgesChange = useCallback(changes => setEdges(old => applyEdgeChanges(changes.filter(c => c.type !== 'remove'), old)), []);
  const run = mode => post({ type: 'run', mode, id: selected });
  const locked = running || invalid;
  return <main>
    <header>
      <strong>Limulus{dirty ? ' •' : ''}</strong>
      <button disabled={locked} onClick={() => edit({ type: 'add' })}>＋ Node</button>
      {host.capabilities?.preview && <button disabled={invalid || !selected} onClick={() => post({ type: 'previewNode', id: selected })}>Preview source</button>}
      <button disabled={locked || !selected} onClick={() => edit({ type: 'rename', id: selected })}>Rename</button>
      <button disabled={locked} onClick={removeSelected}>Delete selected</button>
      <span className="spacer" />
      <button disabled={locked || !nodes.length} onClick={() => run('all')}>▶ Run all</button>
      <button disabled={locked || !selected} onClick={() => run('upstream')}>Run through node</button>
      <button disabled={locked || !selected} onClick={() => run('node_only')}>Run cell</button>
      <button disabled={running || invalid} onClick={() => run('reset')}>Reset runtimes</button>
      {running && <button onClick={() => post({ type: 'stop' })}>■ Stop</button>}
    </header>
    {error && <div role="alert" className="error">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    <div className="graph" tabIndex={0} onKeyDown={event => {
      if (!locked && ['Delete', 'Backspace'].includes(event.key) && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) { event.preventDefault(); removeSelected(); }
    }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodesDraggable={!locked} nodesConnectable={!locked} deleteKeyCode={null} fitView
        onNodeClick={(_, node) => { selectedRef.current = node.id; setSelected(node.id); post({ type: 'openNode', id: node.id }); }}
        onPaneClick={() => { selectedRef.current = null; setSelected(null); }}
        onNodeDragStop={(_, node, moved) => edit({ type: 'move', nodes: (moved?.length ? moved : [node]).map(n => ({ id: n.id, position: n.position })) })}
        onConnect={connection => edit({ type: 'connect', source: connection.source, target: connection.target })}
        onEdgeDoubleClick={(_, edge) => { if (!locked) edit({ type: 'toggleEdge', id: edge.id }); }}>
        <Background /><Controls /><MiniMap nodeColor="var(--lm-accent)" />
      </ReactFlow>
      {!nodes.length && !invalid && <div className="empty">Add a node to start a universe.<br />Click a node to open its Python source.</div>}
    </div>
    <section className="output">
      <div className="output-heading"><strong>Execution output</strong><select aria-label="Filter by universe" value={routeFilter} onChange={e => setRouteFilter(e.target.value)}>
        <option value="">All universes</option>{Object.entries(routes).map(([id, label]) => <option value={id} key={id}>{label} ({id.slice(0, 6)})</option>)}
      </select><select aria-label="Filter by node" value={nodeFilter} onChange={e => setNodeFilter(e.target.value)}><option value="">All nodes</option>{nodes.map(n => <option key={n.id} value={n.id}>#{n.id} · {n.data.title}</option>)}</select><span className="spacer" /><small>Double-click a connection to enable/disable it. · Latest output · 2,000 events / 20 MiB</small></div>
      <div className="logs" role="log" aria-label="Execution output">{logs.filter(e => (!routeFilter || !e.route_id || e.route_id === routeFilter) && (!nodeFilter || e.node_id === nodeFilter)).map((e, i) => <div key={i} className={e.source === 'stderr' || (e.kind === 'completed' && !e.success) ? 'stderr' : ''}><span className="log-label">{e.route_id ? `${e.route_id.slice(0, 6)}${e.node_id ? ' / #' + e.node_id : ''}` : 'system'} · {e.source || e.kind}</span> {e.kind === 'display' || e.kind === 'log' ? <div dangerouslySetInnerHTML={{ __html: renderOutput(e) }} /> : (e.text || (e.kind.endsWith('finished') ? (e.success ? 'Succeeded' : 'Failed') : ''))}</div>)}</div>
    </section>
  </main>;
}

