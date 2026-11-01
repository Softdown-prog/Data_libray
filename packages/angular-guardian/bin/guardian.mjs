#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { verify } from '../src/guardian.mjs';

async function main(argv) {
  if (argv[0] !== 'verify') throw new Error('Uso: angular-guardian verify --url http://127.0.0.1:PORT --config contrato.json --report relatorio.json');
  const args = new Map();
  for (let i = 1; i < argv.length; i += 2) {
    if (!['--url', '--config', '--report'].includes(argv[i]) || !argv[i + 1] || args.has(argv[i])) {
      throw new Error(`Argumento inválido: ${argv[i]}`);
    }
    args.set(argv[i], argv[i + 1]);
  }
  for (const key of ['--url', '--config', '--report']) {
    if (!args.has(key)) throw new Error(`Faltou ${key}`);
  }
  const contract = JSON.parse(await readFile(resolve(args.get('--config')), 'utf8'));
  const report = await verify({ baseUrl: args.get('--url'), contract });
  const reportPath = resolve(args.get('--report'));
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'w' });
  console.log(`ANGULAR GUARDIAN: ${report.status} (${report.results.length} cenários) — ${reportPath}`);
  for (const item of report.results) {
    if (item.status !== 'pass') console.error(`${item.id}: ${item.errors.join('; ')}`);
  }
  if (report.error) console.error(report.error);
  return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}

try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) { console.error(`GUARDIAN CONFIG ERROR: ${error.message}`); process.exitCode = 2; }
