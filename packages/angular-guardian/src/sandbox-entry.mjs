// Minimal container entrypoint: only the dist, digest and declarative case contract.
import { readFile } from 'node:fs/promises';
const input = JSON.parse(await readFile('/opt/sac-input.json', 'utf8'));
process.send = (value, callback) => {
  process.stdout.write('SAC_BROWSER_REPORT ' + JSON.stringify(value) + '\n', callback);
};
await import('./browser-worker.mjs');
process.emit('message', input);
