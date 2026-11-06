const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
export function browserContract(c) {
  if (!keys(c, ['schema_version', 'cases', 'timeout_ms']) || c.schema_version !== 1 || !Number.isInteger(c.timeout_ms) || c.timeout_ms < 100 || c.timeout_ms > 10000 || !Array.isArray(c.cases) || !c.cases.length || c.cases.length > 10) throw new Error('invalid-contract');
  const ids = new Set();
  for (const item of c.cases) {
    if (!keys(item, ['id', 'path', 'expect_visible', 'actions']) || !text(item.id) || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id) || typeof item.path !== 'string' || !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(item.path) || item.path.length > 200 || !Array.isArray(item.expect_visible) || item.expect_visible.length > 10 || !item.expect_visible.every(text) || !Array.isArray(item.actions) || !item.actions.length || item.actions.length > 10) throw new Error('invalid-case');
    ids.add(item.id);
    for (const a of item.actions) if (!keys(a, ['click', 'expect_visible']) || !text(a.click) || !text(a.expect_visible)) throw new Error('invalid-action');
  }
  return structuredClone(c);
}
