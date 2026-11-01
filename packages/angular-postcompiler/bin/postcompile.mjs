#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { verify, inputError } from '../src/index.mjs';

let report;
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--dist' || args[2] !== '--contract') {
    report = inputError('Usage: sac-postcompile --dist DIRECTORY --contract FILE.json');
  } else {
    let contract;
    try { contract = JSON.parse(await readFile(args[3], 'utf8')); }
    catch (error) { report = inputError(error instanceof SyntaxError ? 'Invalid contract JSON' : `Cannot read contract: ${error.code}`, error instanceof SyntaxError || error.code === 'ENOENT' ? 'fail' : 'infra-error'); }
    if (!report) report = await verify(args[1], contract);
  }
} catch { report = inputError('Unexpected validation error', 'infra-error'); }
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.stderr.write(`${report.rule_id}: ${report.status}\n`);
process.exitCode = report.status === 'pass' ? 0 : 1;
