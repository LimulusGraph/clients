import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'limulus-web-package-'));
try {
  const destination = path.join(temporary, 'limulus-web');
  await mkdir(destination);
  for (const name of ['server.cjs', 'dist', 'bin']) await cp(path.join(root, 'apps/web', name), path.join(destination, name), { recursive: true });
  for (const name of ['editor-core', 'node-host']) await cp(path.join(root, 'packages', name), path.join(destination, 'node_modules/@limulus', name), { recursive: true });
  await writeFile(path.join(destination, 'package.json'), JSON.stringify({ name: '@limulus/client-web', version: '0.1.0', private: true, scripts: { start: 'node server.cjs' }, engines: { node: '>=22.12.0' } }, null, 2) + '\n');
  await writeFile(path.join(destination, 'README.md'), '# Limulus web client\n\nRequires Node.js 22.12+ and Python 3 with venv support on macOS or Linux.\nRun `npm start` in this folder, then open http://127.0.0.1:3000.\nNo npm install or Go compiler is needed for this packaged build.\n\nOptional environment variables: PORT, LIMULUS_PYTHON, LIMULUS_SERVER_PATH.\nProjects and Python files use local paths on this machine. Stop with Ctrl+C.\n');
  const artifacts = path.join(root, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const archive = path.join(artifacts, `limulus-web-${process.platform}-${process.arch}.tar.gz`);
  const result = spawnSync('tar', ['-czf', archive, '-C', temporary, 'limulus-web'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status) throw new Error(`Packaging failed (${result.status}).`);
  console.log(archive);
} finally { await rm(temporary, { recursive: true, force: true }); }
