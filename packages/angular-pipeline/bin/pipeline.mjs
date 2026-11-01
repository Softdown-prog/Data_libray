#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { auditPipeline } from '../src/index.mjs';
let report;
try {
  const args = process.argv.slice(2);
  const names = ['--profile', '--workspace', '--dist', '--sources', '--receipt', '--trust-key', '--source-sha', '--project'];
  const options = {};
  if (args.shift() !== '--no-build' || args.length % 2) throw new Error();
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || options[args[i]] !== undefined) throw new Error();
    options[args[i]] = args[i + 1];
  }
  if (!names.slice(0, 7).every(n => options[n])) throw new Error();
  const json = async p => { const bytes = await readFile(p); if (bytes.length > 1024 * 1024) throw new Error(); return JSON.parse(bytes); };
  report = await auditPipeline({ profile: await json(options['--profile']), resources: { workspace: options['--workspace'], dist: options['--dist'], sourceFiles: await json(options['--sources']), project: options['--project'] }, receipt: await json(options['--receipt']), key: await readFile(options['--trust-key']), sourceSha: options['--source-sha'] });
} catch { report = { schema_version: 1, status: 'infra-error', static_pipeline_pass: false, deployment_authorized: false, code: 'cli-input-error' }; }
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.stderr.write(`SAC pipeline: ${report.status}\n`);
process.exitCode = report.static_pipeline_pass ? 0 : 1;
