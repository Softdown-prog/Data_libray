import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';

const RULE = 'SAC-P001';
// A static audit should not load an unbounded build artifact into memory.
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FILE_READS = 512;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
// Exact helper emitted by Beasties' media-script strategy in Angular 22.2.
// It only restores the media attribute of already referenced stylesheets.
const CSS_MEDIA_RESTORE = "document.querySelectorAll('link[data-beasties-media]').forEach(function(l){l.media=l.getAttribute('data-beasties-media');l.removeAttribute('data-beasties-media')})";
const attr = (node, key) => node.attrs?.find(a => a.name === key)?.value;

function isAngularCriticalCssHelper(script, nodes) {
  if (script.parentNode?.tagName !== 'body' || script.attrs.length !== 0 ||
      script.childNodes.length !== 1 || script.childNodes[0].value !== CSS_MEDIA_RESTORE) return false;
  const links = nodes.filter(node => node.tagName === 'link' && attr(node, 'data-beasties-media') !== undefined);
  return links.length > 0 && links.every(link =>
    link.namespaceURI === HTML_NAMESPACE && link.parentNode?.tagName === 'head' &&
    attr(link, 'rel')?.toLowerCase() === 'stylesheet' && Boolean(attr(link, 'href')) &&
    attr(link, 'media') === 'print' && Boolean(attr(link, 'data-beasties-media')?.trim()) &&
    !link.attrs.some(a => a.name.startsWith('on')));
}

class Finding extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new Finding('fail', message); };
const unsupported = message => { throw new Finding('unverified', message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

// Contract paths are artifact-relative, never URLs or shell commands.
function safePath(value) {
  if (typeof value !== 'string' || !value || /[\\%?#:\s\x00-\x1f]/u.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) {
    fail('Unsafe artifact path');
  }
  return value;
}
function contractCheck(c) {
  const keys = ['schema_version', 'index', 'angular_host', 'mode', 'angular_entrypoints', 'assets', 'legacy_react_entrypoints'];
  if (!plain(c) || Object.keys(c).some(k => !keys.includes(k)) || c.schema_version !== 1 ||
      !['angular-only', 'hybrid'].includes(c.mode) || !/^[a-z][a-z0-9]*-[a-z0-9-]+$/.test(c.angular_host ?? '')) fail('Invalid version 1 contract');
  safePath(c.index);
  for (const key of ['angular_entrypoints', 'assets', 'legacy_react_entrypoints']) {
    if (!Array.isArray(c[key]) || (key === 'angular_entrypoints' && !c[key].length)) fail(`Invalid assertions: ${key}`);
    c[key].forEach(safePath);
    if (new Set(c[key]).size !== c[key].length) fail(`Duplicate assertions: ${key}`);
  }
  if (c.angular_entrypoints.some(p => c.legacy_react_entrypoints.includes(p))) fail('Conflicting framework entrypoints');
}
function localURL(value, base) {
  if (typeof value !== 'string' || !value) unsupported('Empty resource URL');
  if (/[\\\x00-\x20\x7f]/u.test(value)) fail('Unsafe resource URL');
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { fail('Invalid URL encoding'); }
  if (decoded !== value && /[%/\\.\x00-\x20]/u.test(decoded)) fail('Ambiguous encoded resource path');
  if (decoded.split(/[/?#]/).includes('..')) fail('Path traversal');
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) unsupported('External or non-file URL is outside static scope');
  const url = new URL(value, base);
  if (url.origin !== 'https://sac.invalid') unsupported('External base URL');
  return url;
}

export async function verify(dist, contract) {
  const evidence = [];
  const check = async (assertion, operation) => {
    try { const details = await operation(); evidence.push({ rule_id: RULE, assertion, status: 'pass', ...details }); }
    catch (error) { evidence.push({ rule_id: RULE, assertion, status: error.status ?? 'infra-error', message: error instanceof Finding ? error.message : `Filesystem error: ${error.code ?? 'unknown'}` }); }
  };
  let root, html;
  await check('contract', async () => { contractCheck(contract); return {}; });
  if (evidence[0].status === 'pass') {
    let reads = 0, totalBytes = 0;
    const file = async relative => {
      safePath(relative);
      if (++reads > MAX_FILE_READS) unsupported('Artifact read count exceeds static scope');
      const target = path.join(root, relative);
      let resolved;
      try { resolved = await realpath(target); }
      catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) fail(`Missing file: ${relative}`); throw error; }
      if (!resolved.startsWith(root + path.sep)) fail(`Symlink escapes dist: ${relative}`);
      const handle = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const before = await handle.stat();
        if (!before.isFile()) fail(`Not a regular file: ${relative}`);
        if (!before.size) fail(`Empty file: ${relative}`);
        const maximum = relative === contract.index ? MAX_INDEX_BYTES : MAX_RESOURCE_BYTES;
        if (!Number.isSafeInteger(before.size) || before.size > maximum ||
            totalBytes + before.size > MAX_TOTAL_BYTES) unsupported('Artifact size exceeds static scope');
        // Read at most the verified size plus one byte to detect file growth.
        const buffer = Buffer.alloc(before.size + 1);
        let count = 0;
        while (count < buffer.length) {
          const result = await handle.read(buffer, count, buffer.length - count, null);
          if (!result.bytesRead) break;
          count += result.bytesRead;
        }
        const after = await handle.stat();
        if (count !== before.size || after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
          unsupported('Artifact changed during inspection');
        }
        totalBytes += count;
        return buffer.subarray(0, count);
      } finally { await handle.close(); }
    };
    await check('index', async () => {
      try { root = await realpath(dist); } catch (error) { if (error.code === 'ENOENT') fail('Missing dist'); throw error; }
      if (contract.index.includes('/')) unsupported('Nested index paths require a deployment mapping');
      html = (await file(contract.index)).toString('utf8');
      return { path: contract.index };
    });
    if (html !== undefined) {
      const nodes = [];
      const visit = node => { nodes.push(node); for (const child of node.childNodes ?? []) visit(child); };
      visit(parse(html)); // Template contents and comments are intentionally inert.
      await check('angular-host', async () => {
        if (!nodes.some(n => n.tagName === contract.angular_host && n.namespaceURI === HTML_NAMESPACE)) fail(`Missing Angular host: ${contract.angular_host}`);
        return { host: contract.angular_host };
      });
      let base, resources = [];
      await check('html-resources', async () => {
        base = new URL(contract.index, 'https://sac.invalid/');
        const bases = nodes.filter(n => n.tagName === 'base' && attr(n, 'href') !== undefined);
        if (bases.length > 1) unsupported('Multiple base href elements');
        if (bases.length) base = localURL(attr(bases[0], 'href'), base);
        if (!base.pathname.endsWith('/') && bases.length) unsupported('base href must end with a slash');
        const mount = base.pathname.endsWith('/') ? base.pathname : base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
        let criticalCssHelper = false;
        for (const n of nodes) {
          if (n.namespaceURI !== HTML_NAMESPACE) continue;
          const script = n.tagName === 'script';
          const css = n.tagName === 'link' && (attr(n, 'rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet');
          const modulePreload = n.tagName === 'link' && (attr(n, 'rel') ?? '').toLowerCase() === 'modulepreload';
          if (!script && !css && !modulePreload) continue;
          const ref = attr(n, script ? 'src' : 'href');
          if (script) {
            const type = (attr(n, 'type') ?? '').trim().toLowerCase();
            if (!['', 'module', 'text/javascript', 'application/javascript'].includes(type)) {
              if (['application/json', 'application/ld+json'].includes(type) && ref === undefined) continue;
              unsupported('Unsupported script type');
            }
            if (attr(n, 'nomodule') !== undefined) unsupported('nomodule requires browser capability selection');
          }
          if (ref === undefined) {
            if (script) {
              if (criticalCssHelper || !isAngularCriticalCssHelper(n, nodes))
                unsupported('Inline executable script requires runtime inspection');
              criticalCssHelper = true;
            }
            continue;
          }
          const url = localURL(ref, base);
          if (!url.pathname.startsWith(mount)) unsupported('Resource outside base href mount');
          const relative = safePath(url.pathname.slice(mount.length));
          await file(relative);
          resources.push({ path: relative, kind: script ? 'script' : css ? 'stylesheet' : 'modulepreload' });
        }
        return {
          base_href: base.pathname, resources,
          ...(criticalCssHelper ? { recognized_inline_scripts: ['angular-critical-css-media-restore'] } : {}),
        };
      });
      if (evidence.at(-1).status === 'pass') {
        for (const entry of contract.angular_entrypoints) await check('angular-entrypoint', async () => {
          if (!resources.some(r => r.kind === 'script' && r.path === entry)) fail(`Angular entrypoint not referenced as script: ${entry}`);
          return { path: entry };
        });
        for (const asset of contract.assets) await check('expected-asset', async () => {
          await file(asset);
          if (!resources.some(r => r.path === asset)) fail(`Expected asset not referenced: ${asset}`);
          return { path: asset };
        });
        await check('framework-mode', async () => {
          const legacy = resources.filter(r => r.kind === 'script' && contract.legacy_react_entrypoints.includes(r.path)).map(r => r.path);
          if (contract.mode === 'angular-only' && legacy.length) fail(`Forbidden React entrypoint: ${legacy.join(', ')}`);
          return { mode: contract.mode, legacy_entrypoints: legacy };
        });
      }
    }
  }
  const status = ['infra-error', 'fail', 'unverified'].find(s => evidence.some(e => e.status === s)) ?? 'pass';
  return { schema_version: 1, rule_id: RULE, rule_name: 'dist-entry-consistency', status, evidence };
}

export function inputError(message, status = 'fail') {
  return { schema_version: 1, rule_id: RULE, rule_name: 'dist-entry-consistency', status, evidence: [{ rule_id: RULE, assertion: 'input', status, message }] };
}
