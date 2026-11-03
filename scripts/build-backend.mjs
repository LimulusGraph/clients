import { createRequire } from 'node:module';
const { backendName } = createRequire(import.meta.url)('@limulus/node-host/platform');
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export async function buildBackend(appRoot) {
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('Build on macOS, Linux or Windows.');
  const out = path.join(appRoot, 'bin');
  await mkdir(out, { recursive: true });
  const server = fileURLToPath(new URL('../../server', import.meta.url));
  const result = spawnSync('go', ['build', '-trimpath', '-o', path.join(out, backendName()), '.'], {
    cwd: server, stdio: 'inherit', env: { ...process.env, GOCACHE: process.env.GOCACHE || path.join(os.tmpdir(), 'limulus-go-cache') },
  });
  if (result.error) throw result.error;
  if (result.status) throw new Error(`Backend build failed (${result.status}).`);
}
