import React from 'react';
import { createRoot } from 'react-dom/client';
import GraphEditor from '@limulus/editor-ui';
import '@limulus/editor-ui/style.css';
import './style.css';

const vscode = acquireVsCodeApi();
const host = {
  capabilities: { preview: true },
  send: message => vscode.postMessage(message),
  subscribe(listener) {
    const receive = event => listener(event.data);
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  },
};
createRoot(document.getElementById('root')).render(<GraphEditor host={host} />);
