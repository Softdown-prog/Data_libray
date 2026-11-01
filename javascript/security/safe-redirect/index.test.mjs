import assert from 'node:assert/strict';
import test from 'node:test';
import { sameOriginUrl } from './index.mjs';

test('destino local', () => {
  assert.equal(sameOriginUrl('/account', 'https://example.com'), 'https://example.com/account');
});
test('origens externas bloqueadas', () => {
  assert.throws(() => sameOriginUrl('//evil.test/', 'https://example.com'), TypeError);
  assert.throws(() => sameOriginUrl('javascript:alert(1)', 'https://example.com'), TypeError);
});
