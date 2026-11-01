import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const NAMES = ['@angular/core', '@angular/compiler-cli', '@angular/compiler', 'typescript'];
export async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}
export async function readJSON(file) { return JSON.parse(await readFile(file, 'utf8')); }
export function metadata({ angular = '19.3.1', ts = '5.7.3', tsRange = '>=5.5 <5.8', nodeRange = '>=18' } = {}) {
  return {
    '@angular/core': { name: '@angular/core', version: angular, engines: { node: nodeRange }, peerDependencies: { '@angular/compiler': angular }, peerDependenciesMeta: { '@angular/compiler': { optional: true } } },
    '@angular/compiler-cli': { name: '@angular/compiler-cli', version: angular, engines: { node: nodeRange }, peerDependencies: { '@angular/compiler': angular, typescript: tsRange }, peerDependenciesMeta: { typescript: { optional: true } } },
    '@angular/compiler': { name: '@angular/compiler', version: angular, engines: { node: nodeRange } },
    'typescript': { name: 'typescript', version: ts, engines: { node: nodeRange } }
  };
}
export async function fixture(t, options = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'sac-pre-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const packages = metadata(options);
  await writeProject(workspace, packages, options);
  return { workspace, packages, packagePath: name => path.join(workspace, 'node_modules', name, 'package.json') };
}
export async function writeProject(root, packages = metadata(), { lockVersion = 3, lock = true } = {}) {
  const dependencies = Object.fromEntries(NAMES.map(n => [n, packages[n].version]));
  await json(path.join(root, 'package.json'), { name: 'synthetic', private: true, dependencies });
  for (const name of NAMES) await json(path.join(root, 'node_modules', name, 'package.json'), packages[name]);
  if (lock) await json(path.join(root, 'package-lock.json'), { name: 'synthetic', lockfileVersion: lockVersion, packages: { '': { name: 'synthetic', dependencies }, ...Object.fromEntries(NAMES.map(n => [`node_modules/${n}`, { version: packages[n].version }])) } });
}
export async function mutateJSON(file, mutate) { const data = await readJSON(file); mutate(data); await json(file, data); }
