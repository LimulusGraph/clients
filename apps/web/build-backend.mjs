import { buildBackend } from '../../scripts/build-backend.mjs';
import { fileURLToPath } from 'node:url';
await buildBackend(fileURLToPath(new URL('.', import.meta.url)));
