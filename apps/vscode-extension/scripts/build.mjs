import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildBackend } from '../../../scripts/build-backend.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  configFile: false, root,
  resolve: { dedupe: ['react', 'react-dom', 'reactflow'] },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: path.join(root, 'dist'), emptyOutDir: true,
    lib: { entry: path.join(root, 'webview/main.jsx'), name: 'LimulusGraph', formats: ['iife'], fileName: () => 'graph.js', cssFileName: 'graph' },
    cssCodeSplit: false,
    commonjsOptions: { include: [/node_modules/, /packages\/.*\.cjs$/] },
  },
});
for (const name of ['preview.js', 'preview.css']) await fs.copyFile(path.join(root, 'webview', name), path.join(root, 'dist', name));
if (!process.argv.includes('--webview-only')) await buildBackend(root);
