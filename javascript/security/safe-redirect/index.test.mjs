/** Casos válidos, adversariais e limitações de javascript.security.safe-redirect */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sameOriginUrl } from './index.mjs';

test('aceita e normaliza somente destinos da mesma origem', () => {
  const cases = [
    ['/account', 'https://example.com', 'https://example.com/account'],
    ['profile', 'https://example.com', 'https://example.com/profile'],
    ['/app?tab=1#details', 'https://example.com', 'https://example.com/app?tab=1#details'],
    ['?page=2', 'https://example.com', 'https://example.com/?page=2'],
    ['https://example.com:443/welcome', 'https://EXAMPLE.COM', 'https://example.com/welcome'],
    ['/dashboard', 'http://localhost:8080', 'http://localhost:8080/dashboard'],
    ['/a/../safe', 'https://example.com', 'https://example.com/safe'],
  ];
  for (const [candidate, origin, expected] of cases) {
    assert.equal(sameOriginUrl(candidate, origin), expected);
  }
});

test('nega origens externas, protocolos perigosos e userinfo', () => {
  const cases = [
    '//evil.test/', '///evil.test', 'https://evil.test/',
    'http://example.com/account', 'https://example.com:444/account',
    'https://example.com.evil.test/', 'https://evil.test@example.com/',
    'javascript:alert(1)', 'data:text/html,hi', 'mailto:person@example.com',
    'ftp://example.com/file', 'https://user:pass@example.com/',
    'https://user@example.com/', '\\evil.test/path', '/\\evil.test/',
  ];
  for (const candidate of cases) {
    assert.throws(() => sameOriginUrl(candidate, 'https://example.com'), TypeError);
  }
});

test('nega string vazia, whitespace, controles e tipos inadequados', () => {
  const cases = [
    '', ' ', ' /ok', '/ok ', '\n/ok', '/ok\r\n', '/tab\there',
    '/null\u0000byte', '/del\u007Fhere', undefined, null, 42, {},
  ];
  for (const candidate of cases) {
    assert.throws(() => sameOriginUrl(candidate, 'https://example.com'), TypeError);
  }
});

test('nega origens base não confiáveis, malformadas ou não HTTP', () => {
  const cases = [
    '', ' ', 'https://example.com/path', 'https://example.com/?x=1',
    'https://example.com/#frag', 'https://user@example.com',
    'https://user:pass@example.com', 'ftp://example.com', 'file:///tmp/app',
    'not-a-url', ' https://example.com', 'https://example.com\n',
    undefined, null, 123,
  ];
  for (const origin of cases) {
    assert.throws(() => sameOriginUrl('/account', origin), TypeError);
  }
});

test('mesma origem não significa rota ou redirecionamento subsequente seguro', () => {
  assert.equal(
    sameOriginUrl('/redirect?next=https%3A%2F%2Fevil.test', 'https://example.com'),
    'https://example.com/redirect?next=https%3A%2F%2Fevil.test',
  );
});
