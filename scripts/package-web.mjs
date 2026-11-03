import { cp, mkdir, mkdtemp, rm, writeFile, readFile, chmod, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = `${process.platform}-${process.arch}`;
if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('Standalone clients support macOS, Linux and Windows.');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
// actions/setup-node and nvm both install the official Node distribution here.
// NODE_RUNTIME_DIR can explicitly select another unpacked official distribution.
const windows = process.platform === 'win32';
const nodeRoot = process.env.NODE_RUNTIME_DIR || (windows ? path.dirname(process.execPath) : path.dirname(path.dirname(process.execPath)));
const nodeName = windows ? 'node.exe' : 'node';
const nodeBinary = path.join(nodeRoot, ...(windows ? [nodeName] : ['bin', nodeName]));
await access(path.join(nodeRoot, 'LICENSE'));
const probe = spawnSync(nodeBinary, ['-p', 'JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})'], { encoding: 'utf8' });
if (probe.status !== 0) throw new Error('Could not execute the Node runtime selected for packaging.');
const runtime = JSON.parse(probe.stdout);
if (`${runtime.platform}-${runtime.arch}` !== target) throw new Error('Node runtime does not match the package target.');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'limulus-web-package-'));
try {
  const destination = path.join(temporary, 'limulus-web');
  await mkdir(path.join(destination, 'bin'), { recursive: true });
  for (const name of ['server.cjs', 'launch.cjs', 'dist']) await cp(path.join(root, 'apps/web', name), path.join(destination, name), { recursive: true });
  await cp(path.join(root, 'apps/web/bin', `limulus-server-${target}${windows ? '.exe' : ''}`), path.join(destination, 'bin', `limulus-server-${target}${windows ? '.exe' : ''}`));
  await cp(nodeBinary, path.join(destination, 'bin', nodeName));
  await chmod(path.join(destination, 'bin', nodeName), 0o755);
  await cp(path.join(nodeRoot, 'LICENSE'), path.join(destination, 'NODE-LICENSE.txt'));
  for (const name of ['editor-core', 'node-host']) await cp(path.join(root, 'packages', name), path.join(destination, 'node_modules/@limulus', name), { recursive: true });
  await writeFile(path.join(destination, 'package.json'), JSON.stringify({ name: '@limulus/client-web', version: manifest.version, private: true, scripts: { start: windows ? 'limulus.cmd' : './limulus' } }, null, 2) + '\n');
  if (windows) await writeFile(path.join(destination, 'limulus.cmd'), '@echo off\r\n"%~dp0bin\\node.exe" "%~dp0launch.cjs" %*\r\n');
  else await writeFile(path.join(destination, 'limulus'), '#!/bin/sh\nAPP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$APP_ROOT/bin/node" "$APP_ROOT/launch.cjs" "$@"\n', { mode: 0o755 });
  await writeFile(path.join(destination, 'README.md'), '# Limulus\n\nRun `./limulus` (or `limulus.cmd` on Windows) to open the editor in your browser. Node.js and the execution backend are bundled; npm and Go are not required.\n\nPython 3 with venv support is required. Limulus manages project dependencies in each project’s .venv. Set LIMULUS_PYTHON to select an interpreter.\n\nKeep the launcher terminal open; Ctrl+C stops the app. Optional: PORT selects a fixed port, LIMULUS_NO_BROWSER=1 disables browser opening.\n');
  const artifacts = path.join(root, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const archive = path.join(artifacts, `limulus-web-${target}.tar.gz`);
  const tar = windows ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const result = spawnSync(tar, ['-czf', archive, '-C', temporary, 'limulus-web'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status) throw new Error(`Packaging failed (${result.status}).`);
  console.log(archive);
} finally { await rm(temporary, { recursive: true, force: true }); }
