// Fail closed when an official Angular fixture has incompatible pinned packages.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/angular-postcompiler/smoke');
const packages = ['@angular/core', '@angular/common', '@angular/compiler',
  '@angular/platform-browser', '@angular/compiler-cli', '@angular/build', '@angular/cli'];
const exactPeers = [
  ['@angular/core', '@angular/compiler'],
  ['@angular/common', '@angular/core'],
  ['@angular/platform-browser', '@angular/core'],
  ['@angular/platform-browser', '@angular/common'],
  ['@angular/compiler-cli', '@angular/compiler'],
];

export function checkFixture(manifest, lock) {
  const errors = [];
  const expected = manifest?.dependencies?.['@angular/core'];
  if (typeof expected !== 'string' || !/^\\d+\\.\\d+\\.\\d+$/.test(expected)) {
    errors.push('Angular core must have an exact pinned version');
    return errors;
  }
  for (const name of packages) {
    const declared = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
    const root = lock?.packages?.['']?.dependencies?.[name] ??
      lock?.packages?.['']?.devDependencies?.[name];
    const installed = lock?.packages?.[`node_modules/${name}`]?.version;
    if (declared !== expected) errors.push(`${name}: manifest must equal ${expected}`);
    if (root !== expected) errors.push(`${name}: lock root must equal ${expected}`);
    if (installed !== expected) errors.push(`${name}: lock package must equal ${expected}`);
  }
  for (const [name, peer] of exactPeers) {
    const peerVersion = lock?.packages?.[`node_modules/${name}`]?.peerDependencies?.[peer];
    if (peerVersion !== expected) errors.push(`${name}: peer ${peer} must equal ${expected}`);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(fixtureDir, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(resolve(fixtureDir, 'package-lock.json'), 'utf8'));
    const errors = checkFixture(manifest, lock);
    if (errors.length) {
      for (const error of errors) process.stderr.write(`Angular fixture conflict: ${error}\\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('Angular fixture manifest, lockfile and exact peers are aligned.\\n');
    }
  } catch {
    process.stderr.write('Angular fixture manifest or lockfile is unavailable/invalid.\\n');
    process.exitCode = 1;
  }
}
