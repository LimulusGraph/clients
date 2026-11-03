import { spawnSync } from 'node:child_process';
const python = process.env.LIMULUS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
