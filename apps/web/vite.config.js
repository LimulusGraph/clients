import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', 'reactflow'] },
  optimizeDeps: { include: ['@limulus/editor-core/graph', '@limulus/editor-core/output', '@limulus/editor-core/execution', '@limulus/editor-core/events'] },
  server: { host: '127.0.0.1', port: 3000, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: { outDir: 'dist', commonjsOptions: { include: [/node_modules/, /packages\/.*\.cjs$/] } },
});
