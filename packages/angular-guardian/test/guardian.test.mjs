import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseUrl, validateContract, verify } from '../src/guardian.mjs';

const contract = { schema_version: 1, cases: [
  { id: 'menu', path: '/', expect_visible: ['#ready'], actions: [{ click: '#open', expect_visible: '#panel' }] },
] };

function fakeBrowser({ fail = false, runtimeError = false } = {}) {
  return {
    newPage: async () => {
      const events = new Map();
      return {
        on: (type, fn) => events.set(type, fn),
        goto: async () => {
          if (runtimeError) events.get('pageerror')?.(new Error('Erro em tempo de execução'));
          return { status: () => 200 };
        },
        url: () => 'http://127.0.0.1:4783/',
        locator: (selector) => ({
          waitFor: async () => { if (fail && selector === '#panel') throw new Error('Elemento não apareceu'); },
          click: async () => {},
        }),
        close: async () => {},
      };
    },
    close: async () => {},
  };
}

test('bloqueia URLs remotas, credenciais e rotas de produção', () => {
  for (const url of ['https://example.com', 'http://example.com', 'http://127.0.0.1:4783/path', 'http://user:pass@localhost:4783']) {
    assert.throws(() => validateBaseUrl(url));
  }
  assert.equal(validateBaseUrl('http://127.0.0.1:4783').hostname, '127.0.0.1');
});

test('não aprova contrato sem asserções ou com id repetido', () => {
  assert.throws(() => validateContract({ schema_version: 1, cases: [{ id: 'empty', path: '/' }] }));
  assert.throws(() => validateContract({ schema_version: 1, cases: [contract.cases[0], contract.cases[0]] }));
  assert.throws(() => validateContract({ schema_version: 1, cases: [{ id: 'bad', path: '//evil', expect_visible: ['#ok'] }] }));
});

test('aprova somente navegação, asserções e cliques comprovados', async () => {
  const report = await verify({ baseUrl: 'http://127.0.0.1:4783', contract, launch: async () => fakeBrowser() });
  assert.equal(report.status, 'pass');
  assert.equal(report.results[0].status, 'pass');
});

test('falha se componente não aparece ou erro de runtime é lançado', async () => {
  for (const flags of [{ fail: true }, { runtimeError: true }]) {
    const report = await verify({ baseUrl: 'http://127.0.0.1:4783', contract, launch: async () => fakeBrowser(flags) });
    assert.equal(report.status, 'fail');
    assert.equal(report.results[0].status, 'fail');
  }
});

test('falha de infraestrutura nunca é classificada como aprovação', async () => {
  const report = await verify({ baseUrl: 'http://127.0.0.1:4783', contract,
    launch: async () => { throw new Error('Chromium indisponível'); } });
  assert.equal(report.status, 'infra-error');
});
