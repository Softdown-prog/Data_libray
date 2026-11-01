import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyWorkspace } from '../src/index.mjs';
import { NAMES, fixture, metadata, writeProject, json, mutateJSON } from './fixtures.mjs';

const verify = (workspace, options = {}) => verifyWorkspace({ workspace, angularVersion: '19.3.1', ...options });

test('compatible installed synthetic toolchain passes with evidence and stable JSON', async t => {
  const { workspace } = await fixture(t);
  const result = await verify(workspace);
  assert.equal(result.schema_version, 1);
  assert.equal(result.rule_id, 'SAC-PRE001');
  assert.equal(result.status, 'pass');
  assert.ok(result.evidence.length > 0);
  assert.ok(result.evidence.every(e => e.assertion && e.status && e.code));
  assert.equal(result.resolution.node_version, process.versions.node);
  assert.deepEqual(await verify(workspace), result);
  for (const name of NAMES) {
    assert.equal(result.resolution.packages[name].installed_version, name === 'typescript' ? '5.7.3' : '19.3.1');
    assert.equal(result.resolution.packages[name].locked_version, result.resolution.packages[name].installed_version);
    assert.ok(result.resolution.packages[name].declared.length > 0);
  }
});
for (const version of [2, 3]) test(`npm lockfile v${version} supported`, async t => {
  const { workspace } = await fixture(t, { lockVersion: version });
  assert.equal((await verify(workspace)).status, 'pass');
});
test('compatibility comes from installed peer range, not an Angular version matrix', async t => {
  const { workspace } = await fixture(t, { angular: '37.2.1', ts: '12.4.0', tsRange: '^12.4.0' });
  assert.equal((await verify(workspace, { angularVersion: '37.2.1' })).status, 'pass');
});
test('TypeScript incompatible with installed compiler-cli peers fails', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/compiler-cli'), data => { data.peerDependencies.typescript = '<5.0.0'; });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('core/compiler-cli incompatibility is proven through published compiler peers', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/core'), data => { data.peerDependencies['@angular/compiler'] = '18.0.0'; });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('compiler-cli/compiler peer mismatch fails independently of TypeScript', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/compiler-cli'), data => { data.peerDependencies['@angular/compiler'] = '>=20'; });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('claimed Angular version is checked against the installed core', async t => {
  const { workspace } = await fixture(t);
  assert.equal((await verify(workspace, { angularVersion: '19.3.2' })).status, 'fail');
});
test('runtime Node version is checked against installed engines', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/compiler-cli'), data => { data.engines.node = '<1'; });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('installed TypeScript engine matters too', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('typescript'), data => { data.engines.node = '>=999'; });
  assert.equal((await verify(workspace)).status, 'fail');
});
for (const name of NAMES) test(`missing installed ${name} is unverified`, async t => {
  const { workspace, packagePath } = await fixture(t);
  await rm(path.dirname(packagePath(name)), { recursive: true });
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('declarations and lockfile do not substitute for absent node_modules', async t => {
  const { workspace } = await fixture(t);
  await rm(path.join(workspace, 'node_modules'), { recursive: true });
  assert.equal((await verify(workspace)).status, 'unverified');
});
for (const mutation of [
  data => { delete data.peerDependencies; },
  data => { delete data.peerDependencies.typescript; },
  data => { data.peerDependencies.typescript = 'not-a-semver-range'; },
  data => { delete data.engines; },
  data => { data.engines.node = 'node-current'; },
  data => { data.version = 'unknown'; }
]) test('insufficient or invalid installed metadata never passes', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/compiler-cli'), mutation);
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('no Angular peer relationship is not assumed compatible solely from matching versions', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/core'), data => { delete data.peerDependencies; });
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('missing lockfile yields unverified', async t => {
  const { workspace } = await fixture(t);
  await rm(path.join(workspace, 'package-lock.json'));
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('unsupported old lockfile format is explicit unverified', async t => {
  const { workspace } = await fixture(t);
  await json(path.join(workspace, 'package-lock.json'), { lockfileVersion: 1, dependencies: {} });
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('lockfile drift is unverified rather than installed compatibility proof', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package-lock.json'), data => { data.packages['node_modules/typescript'].version = '5.6.0'; });
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('missing lock entry yields unverified', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package-lock.json'), data => { delete data.packages['node_modules/typescript']; });
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('declared and installed incompatibility fails despite internally compatible installed peers', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package.json'), data => { data.dependencies.typescript = '<5'; });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('semver OR/caret/tilde ranges are evaluated without false rejection', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package.json'), data => { data.dependencies.typescript = '^5.7.0 || ~6.1.0'; });
  await mutateJSON(packagePath('@angular/compiler-cli'), data => { data.peerDependencies.typescript = '~5.7.0 || >=6 <7'; });
  assert.equal((await verify(workspace)).status, 'pass');
});
test('dependencies in devDependencies are supported', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package.json'), data => { data.devDependencies = data.dependencies; delete data.dependencies; });
  assert.equal((await verify(workspace)).status, 'pass');
});
test('installed optional TypeScript peer is still checked', async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/compiler-cli'), data => { data.peerDependencies.typescript = '^4'; data.peerDependenciesMeta.typescript.optional = true; });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('arbitrary package scripts/config strings are read only and are not echoed', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package.json'), data => { data.scripts = { preinstall: 'throw PRIVATE_TOKEN_VALUE' }; data.privateConfig = { token: 'PRIVATE_TOKEN_VALUE' }; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), data => { data.packages['node_modules/typescript'].resolved = 'https://token:PRIVATE_TOKEN_VALUE@example.invalid/package'; });
  const report = await verify(workspace);
  assert.equal(report.status, 'pass');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TOKEN_VALUE|example\.invalid|preinstall/);
});
test('unsupported declaration URL does not leak its contents', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package.json'), data => { data.dependencies.typescript = 'https://PRIVATE_TOKEN_VALUE@example.invalid/pkg.tgz'; });
  const report = await verify(workspace);
  assert.equal(report.status, 'unverified'); assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TOKEN_VALUE|example\.invalid/);
});
for (const project of ['../outside', 'apps/../../outside', '/absolute', 'apps\\outside']) test(`unsafe project path ${project} rejected`, async t => {
  const { workspace } = await fixture(t);
  assert.equal((await verify(workspace, { project })).status, 'fail');
});
test('workspace traversal is rejected before reads', async t => {
  const { workspace } = await fixture(t);
  assert.equal((await verify(path.join(workspace, 'nested') + '/../')).status, 'fail');
});
test('symlinked installed package JSON escaping workspace fails', async t => {
  const { workspace, packagePath } = await fixture(t);
  const outside = await fixture(t);
  await rm(packagePath('@angular/core'));
  await symlink(outside.packagePath('@angular/core'), packagePath('@angular/core'));
  assert.equal((await verify(workspace)).status, 'fail');
});
test('symlinked node_modules directory escaping workspace fails', async t => {
  const { workspace } = await fixture(t);
  const outside = await fixture(t);
  await rm(path.join(workspace, 'node_modules'), { recursive: true });
  await symlink(path.join(outside.workspace, 'node_modules'), path.join(workspace, 'node_modules'));
  assert.equal((await verify(workspace)).status, 'fail');
});
test('symlinked project directory escaping workspace fails', async t => {
  const { workspace } = await fixture(t);
  const outside = await fixture(t);
  await mkdir(path.join(workspace, 'apps'));
  await symlink(outside.workspace, path.join(workspace, 'apps', 'outside'));
  assert.equal((await verify(workspace, { project: 'apps/outside' })).status, 'fail');
});
test('symlinked lockfile escaping workspace fails', async t => {
  const { workspace } = await fixture(t);
  const outside = await fixture(t);
  await rm(path.join(workspace, 'package-lock.json'));
  await symlink(path.join(outside.workspace, 'package-lock.json'), path.join(workspace, 'package-lock.json'));
  assert.equal((await verify(workspace)).status, 'fail');
});
test('known local configs can be read without interpreting runtime code or tsconfig diagnostics', async t => {
  const { workspace } = await fixture(t);
  await json(path.join(workspace, 'angular.json'), { version: 1, projects: {} });
  await writeFile(path.join(workspace, 'tsconfig.json'), '{ // valid JSONC tsconfig\n "compilerOptions": { "strict": true } }');
  assert.equal((await verify(workspace)).status, 'pass');
});
test('output is stable and verifier leaves package/lock contents untouched', async t => {
  const { workspace } = await fixture(t);
  const files = ['package.json', 'package-lock.json', ...NAMES.map(n => `node_modules/${n}/package.json`)];
  const before = await Promise.all(files.map(f => readFile(path.join(workspace, f), 'utf8')));
  await verify(workspace);
  assert.deepEqual(await Promise.all(files.map(f => readFile(path.join(workspace, f), 'utf8'))), before);
});
test('subdirectory applications with independent locks and installed versions remain separate', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await writeProject(child, metadata({ angular: '23.2.0', ts: '6.2.0', tsRange: '>=6 <7' }));
  const root = await verify(workspace);
  const app = await verify(workspace, { project: 'apps/child', angularVersion: '23.2.0' });
  assert.equal(root.status, 'pass'); assert.equal(app.status, 'pass');
  assert.equal(root.resolution.packages.typescript.installed_version, '5.7.3');
  assert.equal(app.resolution.packages.typescript.installed_version, '6.2.0');
  assert.equal(app.resolution.packages.typescript.locked_version, '6.2.0');
});
test('app passed directly as workspace never borrows installed dependencies from its parent', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await writeProject(child);
  await rm(path.join(child, 'node_modules'), { recursive: true });
  assert.equal((await verify(child)).status, 'unverified');
});
test('npm workspace application uses correct root lock and hoisted installed toolchain', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await mkdir(child, { recursive: true });
  const dependencies = Object.fromEntries(NAMES.map(n => [n, n === 'typescript' ? '^5.7.0' : '^19.3.0']));
  await json(path.join(child, 'package.json'), { name: 'synthetic-child', dependencies });
  await mutateJSON(path.join(workspace, 'package.json'), data => { data.workspaces = ['apps/*']; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), data => { data.packages['apps/child'] = { name: 'synthetic-child', dependencies }; });
  const report = await verify(workspace, { project: 'apps/child' });
  assert.equal(report.status, 'pass');
  assert.equal(report.resolution.packages.typescript.installed_version, '5.7.3');
});
test('subapplication lock is not accidentally combined with root installation', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await writeProject(child, metadata({ angular: '23.2.0', ts: '6.2.0', tsRange: '>=6 <7' }));
  await rm(path.join(child, 'node_modules'), { recursive: true });
  const report = await verify(workspace, { project: 'apps/child', angularVersion: '23.2.0' });
  assert.notEqual(report.status, 'pass');
});
test('TypeScript is resolved from compiler-cli issuer rather than an unrelated app copy', async t => {
  const { workspace, packagePath } = await fixture(t);
  const nested = path.join(workspace, 'node_modules', '@angular', 'compiler-cli', 'node_modules', 'typescript', 'package.json');
  await json(nested, metadata().typescript);
  await mutateJSON(packagePath('typescript'), p => { p.version = '4.9.5'; });
  await mutateJSON(path.join(workspace, 'package.json'), p => { p.dependencies.typescript = '4.9.5'; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => {
    p.packages[''].dependencies.typescript = '4.9.5';
    p.packages['node_modules/typescript'].version = '4.9.5';
    p.packages['node_modules/@angular/compiler-cli/node_modules/typescript'] = { version: '5.7.3' };
  });
  const report = await verify(workspace);
  assert.equal(report.status, 'pass');
  assert.equal(report.resolution.packages.typescript.installed_version, '5.7.3');
  assert.equal(report.resolution.packages.typescript.locked_version, '5.7.3');
  assert.equal(report.resolution.packages.typescript.declared_installed_version, '4.9.5');
  assert.equal(report.resolution.packages.typescript.declared_locked_version, '4.9.5');
});
test('compiler-cli nested incompatible TypeScript is rejected even if app copy is compatible', async t => {
  const { workspace } = await fixture(t);
  const nested = path.join(workspace, 'node_modules', '@angular', 'compiler-cli', 'node_modules', 'typescript', 'package.json');
  await json(nested, { ...metadata().typescript, version: '4.9.5' });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => { p.packages['node_modules/@angular/compiler-cli/node_modules/typescript'] = { version: '4.9.5' }; });
  const report = await verify(workspace);
  assert.equal(report.status, 'fail');
  assert.ok(report.evidence.some(e => e.code === 'typescript-peer-incompatible'));
});
test('internal symlink to package metadata remains a valid confined input', async t => {
  const { workspace, packagePath } = await fixture(t);
  const core = await readFile(packagePath('@angular/core'), 'utf8');
  const safeTarget = path.join(workspace, 'metadata', 'core.json');
  await mkdir(path.dirname(safeTarget), { recursive: true }); await writeFile(safeTarget, core);
  await rm(packagePath('@angular/core')); await symlink(safeTarget, packagePath('@angular/core'));
  assert.equal((await verify(workspace)).status, 'pass');
});
test('pre-aborted signal yields infrastructure error without claiming completion', async t => {
  const { workspace } = await fixture(t);
  const controller = new AbortController(); controller.abort();
  assert.equal((await verify(workspace, { signal: controller.signal })).status, 'infra-error');
});
test('oversized metadata yields bounded unverified result', async t => {
  const { workspace } = await fixture(t);
  await writeFile(path.join(workspace, 'tsconfig.json'), Buffer.alloc(4 * 1024 * 1024 + 1, 32));
  const report = await verify(workspace);
  assert.equal(report.status, 'unverified');
  assert.ok(report.evidence.some(e => e.code === 'metadata-size-limit'));
});
test('malformed package JSON is unverified without exposing its contents', async t => {
  const { workspace, packagePath } = await fixture(t);
  await writeFile(packagePath('@angular/compiler-cli'), '{PRIVATE_TOKEN_VALUE');
  const report = await verify(workspace);
  assert.equal(report.status, 'unverified'); assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TOKEN_VALUE/);
});
test('directory instead of package metadata is unverified', async t => {
  const { workspace, packagePath } = await fixture(t);
  await rm(packagePath('typescript')); await mkdir(packagePath('typescript'));
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('filesystem symlink loop is infrastructure error rather than pass', async t => {
  const { workspace, packagePath } = await fixture(t);
  await rm(packagePath('typescript'));
  await symlink('package.json', packagePath('typescript'));
  assert.equal((await verify(workspace)).status, 'infra-error');
});
test('workspace Node engine declaration is verified when present', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package.json'), p => { p.engines = { node: '<1' }; });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('missing profile version cannot be promoted to installed evidence', async t => {
  const { workspace } = await fixture(t);
  assert.equal((await verify(workspace, { angularVersion: undefined })).status, 'unverified');
});
test('compatible compiler-cli TypeScript cannot conceal incompatible app declaration/install', async t => {
  const { workspace, packagePath } = await fixture(t);
  const nested = path.join(workspace, 'node_modules', '@angular', 'compiler-cli', 'node_modules', 'typescript', 'package.json');
  await json(nested, metadata().typescript);
  await mutateJSON(packagePath('typescript'), p => { p.version = '4.9.5'; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => {
    p.packages['node_modules/typescript'].version = '4.9.5';
    p.packages['node_modules/@angular/compiler-cli/node_modules/typescript'] = { version: '5.7.3' };
  });
  const report = await verify(workspace);
  assert.equal(report.status, 'fail');
  assert.equal(report.resolution.packages.typescript.installed_version, '5.7.3');
  assert.equal(report.resolution.packages.typescript.declared_installed_version, '4.9.5');
});
test('nested compiler-cli dependency lock drift is unverified despite valid app resolution', async t => {
  const { workspace } = await fixture(t);
  const nested = path.join(workspace, 'node_modules', '@angular', 'compiler-cli', 'node_modules', 'typescript', 'package.json');
  await json(nested, metadata().typescript);
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => {
    p.packages['node_modules/@angular/compiler-cli/node_modules/typescript'] = { version: '5.6.0' };
  });
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('independent app lock isolates it from an incompatible root Node engine', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await writeProject(child);
  await mutateJSON(path.join(workspace, 'package.json'), p => { p.engines = { node: '<1' }; });
  assert.equal((await verify(workspace, { project: 'apps/child' })).status, 'pass');
});
test('nested app with no declarations outside npm workspace membership cannot inherit root dependencies', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await json(path.join(child, 'package.json'), { name: 'independent-child' });
  const report = await verify(workspace, { project: 'apps/child' });
  assert.equal(report.status, 'unverified');
});
test('proven npm workspace membership allows root dependency inheritance', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await json(path.join(child, 'package.json'), { name: 'workspace-child' });
  await mutateJSON(path.join(workspace, 'package.json'), p => { p.workspaces = ['apps/*']; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => { p.packages['apps/child'] = { name: 'workspace-child' }; });
  const report = await verify(workspace, { project: 'apps/child' });
  assert.equal(report.status, 'pass');
  assert.ok(report.resolution.packages.typescript.declared.every(d => d.source === 'workspace'));
});
test('npm workspace member honors root Node engine constraint', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await json(path.join(child, 'package.json'), { name: 'workspace-child' });
  await mutateJSON(path.join(workspace, 'package.json'), p => { p.workspaces = ['apps/*']; p.engines = { node: '<1' }; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => { p.packages['apps/child'] = { name: 'workspace-child' }; });
  assert.equal((await verify(workspace, { project: 'apps/child' })).status, 'fail');
});
test('app with independent lock does not inherit root constraints even if its path matches workspaces', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await writeProject(child);
  await mutateJSON(path.join(workspace, 'package.json'), p => { p.workspaces = ['apps/*']; p.engines = { node: '<1' }; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => { p.packages['apps/child'] = { name: 'synthetic' }; });
  assert.equal((await verify(workspace, { project: 'apps/child' })).status, 'pass');
});
test('nonmatching npm workspace glob cannot authorize root dependency inheritance', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await json(path.join(child, 'package.json'), { name: 'independent-child' });
  await mutateJSON(path.join(workspace, 'package.json'), p => { p.workspaces = ['tools/*']; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => { p.packages['apps/child'] = { name: 'independent-child' }; });
  assert.equal((await verify(workspace, { project: 'apps/child' })).status, 'unverified');
});
for (const [field, mutation] of [
  ['peer range', p => { p.peerDependencies.typescript = '   '; }],
  ['Node engine', p => { p.engines.node = ''; }]
]) test(`blank installed ${field} is unverified rather than wildcard compatibility`, async t => {
  const { workspace, packagePath } = await fixture(t);
  await mutateJSON(packagePath('@angular/compiler-cli'), mutation);
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('blank declared dependency range is not treated as wildcard proof', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package.json'), p => { p.dependencies.typescript = ' '; });
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('prerelease TypeScript is not silently included in stable installed peer range', async t => {
  const { workspace } = await fixture(t, { ts: '5.8.0-beta.1', tsRange: '>=5.5 <5.8' });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('explicit installed peer prerelease allowance avoids a false positive', async t => {
  const { workspace } = await fixture(t, { ts: '5.8.0-beta.1', tsRange: '>=5.8.0-beta.1 <5.8.0' });
  assert.equal((await verify(workspace)).status, 'pass');
});
test('app-resolved TypeScript engine is verified separately from compiler-cli copy', async t => {
  const { workspace, packagePath } = await fixture(t);
  const nested = path.join(workspace, 'node_modules', '@angular', 'compiler-cli', 'node_modules', 'typescript', 'package.json');
  await json(nested, metadata().typescript);
  await mutateJSON(packagePath('typescript'), p => { p.engines.node = '>=999'; });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => { p.packages['node_modules/@angular/compiler-cli/node_modules/typescript'] = { version: '5.7.3' }; });
  assert.equal((await verify(workspace)).status, 'fail');
});
test('npm optionalDependencies override matching dependencies rather than impose both ranges', async t => {
  const { workspace } = await fixture(t);
  await mutateJSON(path.join(workspace, 'package.json'), p => {
    p.dependencies.typescript = '<5';
    p.optionalDependencies = { typescript: '^5.7.0' };
  });
  await mutateJSON(path.join(workspace, 'package-lock.json'), p => {
    p.packages[''].dependencies.typescript = '<5';
    p.packages[''].optionalDependencies = { typescript: '^5.7.0' };
  });
  assert.equal((await verify(workspace)).status, 'pass');
});
test('additional Angular peer copy requires lock proof even when its version matches', async t => {
  const { workspace } = await fixture(t);
  const nested = path.join(workspace, 'node_modules', '@angular', 'core', 'node_modules', '@angular', 'compiler', 'package.json');
  await json(nested, metadata()['@angular/compiler']);
  assert.equal((await verify(workspace)).status, 'unverified');
});
test('existing package without metadata cannot be skipped to claim ancestor resolution', async t => {
  const { workspace } = await fixture(t);
  const child = path.join(workspace, 'apps', 'child');
  await mkdir(path.join(child, 'node_modules', '@angular', 'core'), { recursive: true });
  await json(path.join(child, 'package.json'), { dependencies: Object.fromEntries(NAMES.map(n => [n, n === 'typescript' ? '5.7.3' : '19.3.1'])) });
  await writeFile(path.join(child, 'node_modules', '@angular', 'core', 'index.js'), 'throw new Error("must never run")');
  assert.equal((await verify(workspace, { project: 'apps/child' })).status, 'unverified');
});
test('symlink escape is rejected even when target package has no metadata file', async t => {
  const { workspace, packagePath } = await fixture(t);
  const outside = await fixture(t);
  await rm(outside.packagePath('@angular/core'));
  await rm(path.dirname(packagePath('@angular/core')), { recursive: true });
  await symlink(path.dirname(outside.packagePath('@angular/core')), path.dirname(packagePath('@angular/core')));
  assert.equal((await verify(workspace)).status, 'fail');
});
