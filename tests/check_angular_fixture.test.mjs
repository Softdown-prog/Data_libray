import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkFixture } from '../scripts/check_angular_fixture.mjs';

const manifest = JSON.parse(readFileSync(new URL('../packages/angular-postcompiler/smoke/package.json', import.meta.url)));
const lock = JSON.parse(readFileSync(new URL('../packages/angular-postcompiler/smoke/package-lock.json', import.meta.url)));

test('official fixture has coherent Angular versions, lockfile and exact peers', () => {
  assert.deepEqual(checkFixture(manifest, lock), []);
});

test('partial Dependabot bumps fail before npm ci', () => {
  const bad = structuredClone(manifest);
  bad.dependencies['@angular/core'] = '22.1.0';
  assert.ok(checkFixture(bad, lock).some(error => error.includes('@angular/common')));
});

test('a forged or stale lockfile fails the gate', () => {
  const bad = structuredClone(lock);
  bad.packages['node_modules/@angular/compiler-cli'].peerDependencies['@angular/compiler'] = '22.2.4';
  assert.ok(checkFixture(manifest, bad).some(error => error.includes('peer @angular/compiler')));
});
