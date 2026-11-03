import platform from '@limulus/node-host/platform';
import { createServer } from 'vite';
import { access } from 'node:fs/promises';
import { buildBackend } from '../../scripts/build-backend.mjs';
import { fileURLToPath } from 'node:url';
import web from './server.cjs';
if (!process.env.LIMULUS_SERVER_PATH) {
  try { await access(new URL(`bin/${platform.backendName()}`, import.meta.url)); }
  catch { await buildBackend(fileURLToPath(new URL('.', import.meta.url))); }
}
const host = await web.start({ port: 3001, dev: true });
const vite = await createServer();
await vite.listen();
vite.printUrls();
async function stop() { await vite.close(); await host.close(); }
process.once('SIGINT', () => stop().then(() => process.exit()));
process.once('SIGTERM', () => stop().then(() => process.exit()));
