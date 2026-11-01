import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import semver from 'semver';

const REQUIRED = ['@angular/compiler-cli', '@angular/core', '@angular/compiler', 'typescript'];
const OPTIONAL = ['@angular/cli', '@angular/build'];
const ASSERTIONS = ['workspace-metadata', 'installed-resolution', 'declared-resolution', 'lockfile-resolution', 'typescript-peers', 'angular-peers', 'node-engines', 'profile-version'];
const MAX_FILE = 4 * 1024 * 1024, MAX_BYTES = 24 * 1024 * 1024, MAX_READS = 128;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const version = v => typeof v === 'string' ? semver.valid(v) : null;
const range = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 512 ? semver.validRange(v) : null;
const within = (root, target) => target === root || target.startsWith(root + path.sep);
class Finding extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const reject = (status, code) => { throw new Finding(status, code); };
function projectPath(value) {
  if (value === '.') return '';
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /[\\%?#:\x00-\x20\x7f]/.test(value) || value.split('/').some(p => !p || p === '..' || p === '.')) reject('fail', 'unsafe-project-path');
  return value;
}
function workspacePath(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value) || value.split(/[\\/]/).includes('..')) reject('fail', 'unsafe-workspace-path');
  return path.resolve(value);
}

/** Read-only preflight of a trusted local workspace. No workspace JS is loaded. */
export async function verifyWorkspace({ workspace, project = '.', angularVersion, signal } = {}) {
  const evidence = [];
  const resolution = { packages: {}, node_version: process.versions.node };
  const add = (assertion, status, code) => evidence.push({ assertion, status, code });
  const check = async (assertion, fn) => {
    try { await fn(); }
    catch (error) { add(assertion, error instanceof Finding ? error.status : 'infra-error', error instanceof Finding ? error.code : 'filesystem-error'); }
  };
  const abort = () => { if (signal?.aborted) reject('infra-error', 'analysis-aborted'); };
  let root, app;
  await check('workspace-metadata', async () => {
    const input = workspacePath(workspace);
    const relative = projectPath(project);
    try { root = await realpath(input); } catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) reject('unverified', 'workspace-missing'); throw e; }
    try { app = await realpath(path.join(root, relative)); } catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) reject('unverified', 'project-missing'); throw e; }
    if (!within(root, app)) reject('fail', 'symlink-outside-workspace');
    if (path.relative(root, app).split(path.sep).length > 16) reject('unverified', 'project-depth-limit');
    abort();
  });
  if (root && app && !evidence.length) {
    let reads = 0, bytes = 0;
    const cache = new Map();
    // Only known filenames are requested. No recursive scanning, require or imports.
    const read = async file => {
      abort();
      if (!within(root, file)) reject('fail', 'read-outside-workspace');
      if (cache.has(file)) return cache.get(file);
      if (++reads > MAX_READS) reject('unverified', 'read-count-limit');
      let resolved;
      try { resolved = await realpath(file); }
      catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) { cache.set(file, null); return null; } throw e; }
      if (!within(root, resolved)) reject('fail', 'symlink-outside-workspace');
      const handle = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const info = await handle.stat();
        if (!info.isFile()) reject('unverified', 'metadata-not-regular-file');
        if (info.size > MAX_FILE || bytes + info.size > MAX_BYTES) reject('unverified', 'metadata-size-limit');
        const buffer = Buffer.alloc(Math.min(MAX_FILE + 1, info.size + 1));
        let length = 0;
        while (length < buffer.length) {
          abort();
          const chunk = await handle.read(buffer, length, buffer.length - length, null);
          if (!chunk.bytesRead) break;
          length += chunk.bytesRead;
        }
        if (length > info.size) reject('unverified', 'metadata-changed-during-read');
        bytes += length;
        const text = buffer.subarray(0, length).toString('utf8');
        cache.set(file, text); return text;
      } finally { await handle.close(); }
    };
    const json = async file => {
      const text = await read(file);
      if (text === null) return null;
      let value;
      try { value = JSON.parse(text); } catch { reject('unverified', 'invalid-metadata-json'); }
      if (!plain(value)) reject('unverified', 'invalid-metadata-object');
      return value;
    };
    const ancestors = start => {
      const dirs = [];
      for (let dir = start; within(root, dir); dir = path.dirname(dir)) {
        dirs.push(dir); if (dir === root) break;
        if (dirs.length > 32) reject('unverified', 'resolution-depth-limit');
      }
      return dirs;
    };
    const resolvePackage = async (name, issuer) => {
      for (const dir of ancestors(issuer)) {
        if (path.basename(dir) === 'node_modules') continue;
        const file = path.join(dir, 'node_modules', name, 'package.json');
        const data = await json(file);
        if (data !== null) {
          if (data.name !== name || !version(data.version)) reject('unverified', 'invalid-installed-package');
          return { data, directory: await realpath(path.dirname(file)), file };
        }
        // An existing package without metadata must not be silently skipped in
        // favor of an ancestor: Node could load its index.js instead.
        let directory;
        try { directory = await realpath(path.dirname(file)); }
        catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; }
        if (directory && !within(root, directory)) reject('fail', 'symlink-outside-workspace');
        if (directory) reject('unverified', 'installed-package-metadata-missing');
      }
      return null;
    };
    let appManifest, rootManifest;
    await check('workspace-metadata', async () => {
      appManifest = await json(path.join(app, 'package.json'));
      if (!appManifest) reject('unverified', 'project-package-missing');
      rootManifest = app === root ? appManifest : null;
      // These files are bounded/confined opaque inputs, not ngtsc diagnostics.
      for (const dir of [app]) for (const file of ['angular.json', 'tsconfig.json']) await read(path.join(dir, file));
      add('workspace-metadata', 'pass', 'local-metadata-read');
    });
    const installed = {}, appInstalled = {};
    if (appManifest) {
      let lock, lockRoot, workspaceMember = app === root;
      await check('lockfile-resolution', async () => {
        for (const dir of ancestors(app)) {
          const shrink = await json(path.join(dir, 'npm-shrinkwrap.json'));
          const packageLock = shrink ? null : await json(path.join(dir, 'package-lock.json'));
          if (shrink || packageLock) { lock = shrink ?? packageLock; lockRoot = dir; break; }
          if (await read(path.join(dir, 'pnpm-lock.yaml')) !== null || await read(path.join(dir, 'yarn.lock')) !== null) reject('unverified', 'lock-format-unsupported');
        }
        if (!lock) reject('unverified', 'lockfile-missing');
        if (![2, 3].includes(lock.lockfileVersion) || !plain(lock.packages)) reject('unverified', 'lock-format-unsupported');
      });
      if (app !== root && lockRoot === root) await check('workspace-metadata', async () => {
        const candidate = await json(path.join(root, 'package.json'));
        const patterns = Array.isArray(candidate?.workspaces) ? candidate.workspaces : candidate?.workspaces?.packages;
        const relative = path.relative(root, app).split(path.sep).join('/');
        // Bounded npm workspace globs: literals, * and **. No expansion or IO.
        const matches = pattern => {
          if (typeof pattern !== 'string' || pattern.length > 256 || !/^[A-Za-z0-9_./*-]+$/.test(pattern) || pattern.split('/').some(p => !p || p === '.' || p === '..')) return false;
          const parts = pattern.split('/'), segments = relative.split('/');
          if (parts.some(p => p.includes('*') && !['*', '**'].includes(p))) return false;
          const memo = new Map();
          const match = (i, j) => {
            const key = `${i}:${j}`;
            if (memo.has(key)) return memo.get(key);
            const ok = i === parts.length ? j === segments.length :
              parts[i] === '**' ? match(i + 1, j) || (j < segments.length && match(i, j + 1)) :
                j < segments.length && (parts[i] === '*' || parts[i] === segments[j]) && match(i + 1, j + 1);
            memo.set(key, ok); return ok;
          };
          return match(0, 0);
        };
        workspaceMember = Array.isArray(patterns) && patterns.length <= 256 && patterns.some(matches) && plain(lock?.packages) && Object.hasOwn(lock.packages, relative) && plain(lock.packages[relative]);
        if (!workspaceMember) reject('unverified', 'npm-workspace-membership-unproven');
        rootManifest = candidate;
        for (const file of ['angular.json', 'tsconfig.json']) await read(path.join(root, file));
      });
      for (const name of REQUIRED) await check('installed-resolution', async () => {
        // compiler-cli is the issuer of its TypeScript/compiler dependencies.
        const issuer = ['typescript', '@angular/compiler'].includes(name) && installed['@angular/compiler-cli'] ? installed['@angular/compiler-cli'].directory : app;
        const value = await resolvePackage(name, issuer);
        installed[name] = value;
        appInstalled[name] = await resolvePackage(name, app);
        resolution.packages[name] = { declared: [], locked_version: null, declared_locked_version: null, installed_version: value ? version(value.data.version) : null, declared_installed_version: appInstalled[name] ? version(appInstalled[name].data.version) : null };
        if (!value) reject('unverified', 'installed-package-missing');
      });
      if (REQUIRED.every(n => installed[n])) add('installed-resolution', 'pass', 'installed-packages-resolved');
      const declaration = (manifest, name) => {
        const fields = plain(manifest?.optionalDependencies) && Object.hasOwn(manifest.optionalDependencies, name) ? ['optionalDependencies'] : ['dependencies', 'devDependencies'];
        const deps = fields.filter(k => plain(manifest?.[k]) && Object.hasOwn(manifest[k], name));
        return deps.map(k => manifest[k][name]);
      };
      const names = [...REQUIRED];
      for (const name of OPTIONAL) {
        if (declaration(appManifest, name).length || declaration(rootManifest, name).length) {
          names.push(name);
          await check('installed-resolution', async () => {
            const value = await resolvePackage(name, app); installed[name] = value; appInstalled[name] = value;
            resolution.packages[name] = { declared: [], locked_version: null, declared_locked_version: null, installed_version: value ? version(value.data.version) : null, declared_installed_version: appInstalled[name] ? version(appInstalled[name].data.version) : null };
            if (!value) reject('unverified', 'declared-tool-missing');
          });
        }
      }
      for (const name of names) await check('declared-resolution', async () => {
        const local = declaration(appManifest, name);
        const inherited = !local.length && rootManifest && app !== root ? declaration(rootManifest, name) : [];
        const declarations = local.length ? local : inherited;
        const metadata = resolution.packages[name];
        if (!metadata) reject('unverified', 'installed-resolution-incomplete');
        metadata.declared = declarations.map(raw => ({ source: local.length ? 'project' : 'workspace', range: range(raw) }));
        if (!declarations.length) reject('unverified', 'dependency-not-declared');
        if (!appInstalled[name]) reject('unverified', 'declared-installation-missing');
        for (const spec of declarations) {
          const expected = range(spec);
          if (!expected) reject('unverified', 'declaration-range-unsupported');
          if (!semver.satisfies(appInstalled[name].data.version, expected)) reject('fail', 'declared-installed-mismatch');
        }
        add('declared-resolution', 'pass', 'declared-range-satisfied');
      });
      const lockedVersion = current => {
        if (!lock || ![2, 3].includes(lock.lockfileVersion) || !plain(lock.packages)) reject('unverified', 'lock-format-unsupported');
        if (app !== root && lockRoot !== app && !(lockRoot === root && workspaceMember)) reject('unverified', 'lock-workspace-scope-unproven');
        if (!current) reject('unverified', 'installed-package-missing');
        if (!within(lockRoot, current.file)) reject('unverified', 'installation-outside-lock-scope');
        const key = path.relative(lockRoot, path.dirname(current.file)).split(path.sep).join('/');
        const pinned = lock.packages[key];
        if (!plain(pinned) || pinned.link || !version(pinned.version) || (pinned.name !== undefined && pinned.name !== current.data.name)) reject('unverified', 'locked-version-missing');
        if (!semver.eq(pinned.version, current.data.version)) reject('unverified', 'lock-installed-drift');
        return version(pinned.version);
      };
      await check('lockfile-resolution', async () => {
        if (!lock || ![2, 3].includes(lock.lockfileVersion) || !plain(lock.packages)) reject('unverified', 'lock-format-unsupported');
        if (app !== root && lockRoot !== app && !(lockRoot === root && workspaceMember)) reject('unverified', 'lock-workspace-scope-unproven');
        for (const name of names) {
          for (const [current, field] of [[installed[name], 'locked_version'], [appInstalled[name], 'declared_locked_version']]) {
            resolution.packages[name][field] = lockedVersion(current);
          }
        }
        add('lockfile-resolution', 'pass', 'npm-lock-matches-installation');
      });
      await check('typescript-peers', async () => {
        const cli = installed['@angular/compiler-cli'], ts = installed.typescript;
        if (!cli || !ts) reject('unverified', 'installed-package-missing');
        const expected = range(cli.data.peerDependencies?.typescript);
        if (!expected) reject('unverified', 'typescript-peer-missing-or-invalid');
        if (!semver.satisfies(ts.data.version, expected)) reject('fail', 'typescript-peer-incompatible');
        add('typescript-peers', 'pass', 'installed-typescript-peer-satisfied');
      });
      await check('angular-peers', async () => {
        const angularNames = REQUIRED.filter(n => n.startsWith('@angular/'));
        if (!angularNames.every(n => installed[n])) reject('unverified', 'installed-package-missing');
        const edges = new Map(angularNames.map(n => [n, new Set()]));
        for (const owner of names) {
          if (!installed[owner]) continue;
          for (const peer of angularNames) {
            const raw = installed[owner].data.peerDependencies?.[peer];
            if (raw === undefined) continue;
            const expected = range(raw);
            if (!expected) reject('unverified', 'angular-peer-range-invalid');
            const resolved = await resolvePackage(peer, installed[owner].directory);
            if (!resolved) reject('unverified', 'angular-peer-not-resolved');
            if (!semver.satisfies(resolved.data.version, expected)) reject('fail', 'angular-peer-incompatible');
            lockedVersion(resolved);
            const peerEngine = range(resolved.data.engines?.node);
            if (!peerEngine) reject('unverified', 'node-engine-missing-or-invalid');
            if (!semver.satisfies(process.versions.node, peerEngine)) reject('fail', 'node-engine-incompatible');
            if (!semver.eq(resolved.data.version, installed[peer].data.version)) reject('unverified', 'multiple-angular-peer-resolutions');
            if (edges.has(owner)) { edges.get(owner).add(peer); edges.get(peer).add(owner); }
          }
        }
        const visited = new Set(), queue = ['@angular/core'];
        while (queue.length) { const next = queue.pop(); if (visited.has(next)) continue; visited.add(next); queue.push(...edges.get(next)); }
        if (!visited.has('@angular/compiler-cli')) reject('unverified', 'angular-peer-relationship-unproven');
        add('angular-peers', 'pass', 'installed-angular-peer-relationship-satisfied');
      });
      await check('node-engines', async () => {
        if (names.some(n => !installed[n])) reject('unverified', 'installed-package-missing');
        for (const name of names) {
          for (const current of [installed[name], appInstalled[name]]) {
            if (!current) reject('unverified', 'installed-package-missing');
            const expected = range(current.data.engines?.node);
            if (!expected) reject('unverified', 'node-engine-missing-or-invalid');
            if (!semver.satisfies(process.versions.node, expected)) reject('fail', 'node-engine-incompatible');
          }
        }
        for (const manifest of [...new Set([appManifest, rootManifest])]) {
          if (manifest?.engines?.node === undefined) continue;
          const expected = range(manifest.engines.node);
          if (!expected) reject('unverified', 'workspace-node-engine-invalid');
          if (!semver.satisfies(process.versions.node, expected)) reject('fail', 'workspace-node-engine-incompatible');
        }
        add('node-engines', 'pass', 'runtime-node-engines-satisfied');
      });
      for (const name of names) {
        if (!resolution.packages[name]) continue;
        resolution.packages[name].node_engine = range(installed[name]?.data.engines?.node);
        resolution.packages[name].declared_node_engine = range(appInstalled[name]?.data.engines?.node);
        resolution.packages[name].peer_ranges = Object.fromEntries(REQUIRED.filter(peer => installed[name]?.data.peerDependencies?.[peer] !== undefined).map(peer => [peer, range(installed[name].data.peerDependencies[peer])]));
      }
      await check('profile-version', async () => {
        if (!version(angularVersion) || !installed['@angular/core']) reject('unverified', 'profile-version-unproven');
        if (!semver.eq(angularVersion, installed['@angular/core'].data.version)) reject('fail', 'profile-installed-angular-mismatch');
        add('profile-version', 'pass', 'profile-matches-installed-angular');
      });
    }
  }
  // No vacuous pass, even if a future code path accidentally skips an assertion.
  for (const assertion of ASSERTIONS) if (!evidence.some(e => e.assertion === assertion)) add(assertion, 'unverified', 'assertion-not-verified');
  const status = ['infra-error', 'fail', 'unverified'].find(s => evidence.some(e => e.status === s)) ?? 'pass';
  return { schema_version: 1, rule_id: 'SAC-PRE001', status, evidence, resolution };
}

export const assertions = Object.freeze([...ASSERTIONS]);
