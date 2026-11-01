/**
 * Verificação de contratos de interface em navegador real.
 * Não executa scripts do contrato nem aceita URLs de produção/remotas.
 */
const textValue = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 250) {
    throw new TypeError(`${label} deve ser texto não vazio de até 250 caracteres`);
  }
  return value;
};

export function validateBaseUrl(value) {
  const url = new URL(textValue(value, 'baseUrl'));
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new TypeError('O Guardian v0.1 aceita somente HTTP em loopback, com app compilado em servidor local');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new TypeError('baseUrl não pode incluir credenciais, path, query ou fragmento');
  }
  return url;
}

function validatePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > 200 ||
      path.includes('\\') || path.includes('?') || path.includes('#') || path.split('/').includes('..')) {
    throw new TypeError('path deve ser uma rota local absoluta, sem traversal/query/hash');
  }
  return path;
}

export function validateContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract) || contract.schema_version !== 1 ||
      !Array.isArray(contract.cases) || contract.cases.length < 1 || contract.cases.length > 30) {
    throw new TypeError('Contrato inválido: schema_version=1 e cases de 1 a 30 são obrigatórios');
  }
  const ids = new Set();
  const cases = contract.cases.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Caso inválido');
    const id = textValue(item.id, 'id');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || ids.has(id)) throw new TypeError(`id duplicado ou inválido: ${id}`);
    ids.add(id);
    const path = validatePath(item.path ?? '/');
    const visible = item.expect_visible ?? [];
    const actions = item.actions ?? [];
    if (!Array.isArray(visible) || visible.length > 20 || !Array.isArray(actions) || actions.length > 20 ||
        (visible.length === 0 && actions.length === 0)) {
      throw new TypeError(`O caso ${id} precisa de asserções explícitas`);
    }
    for (const selector of visible) textValue(selector, `expect_visible de ${id}`);
    for (const action of actions) {
      if (!action || typeof action !== 'object' || Array.isArray(action)) throw new TypeError(`Ação inválida em ${id}`);
      textValue(action.click, `click de ${id}`);
      textValue(action.expect_visible, `expect_visible após click em ${id}`);
    }
    return { id, path, expect_visible: visible, actions };
  });
  return cases;
}

const brief = (error) => String(error?.message ?? error).slice(0, 600);

/** launch injetável para testar a política sem baixar navegador. */
export async function verify({ baseUrl, contract, launch, timeoutMs = 12000 }) {
  const started_at = new Date().toISOString();
  const origin = validateBaseUrl(baseUrl);
  const cases = validateContract(contract);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw new TypeError('timeoutMs fora do intervalo seguro');
  }
  const results = [];
  let browser;
  try {
    const launcher = launch ?? (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({ headless: true });
    });
    browser = await launcher();
  } catch (error) {
    return { schema_version: 1, status: 'infra-error', started_at, finished_at: new Date().toISOString(),
      results, error: `Falha ao iniciar Chromium: ${brief(error)}` };
  }
  try {
    for (const scenario of cases) {
      const errors = [];
      let page;
      try {
        page = await browser.newPage();
        page.on('pageerror', (error) => errors.push(`pageerror: ${brief(error)}`));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 600)}`);
        });
        page.on('response', (response) => {
          if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url().slice(0, 250)}`);
        });
        const response = await page.goto(new URL(scenario.path, origin).toString(), {
          waitUntil: 'domcontentloaded', timeout: timeoutMs,
        });
        if (!response || response.status() >= 400) {
          throw new Error(`Falha na navegação HTTP: ${response?.status() ?? 'sem resposta'}`);
        }
        for (const selector of scenario.expect_visible) {
          await page.locator(selector).waitFor({ state: 'visible', timeout: timeoutMs });
        }
        for (const action of scenario.actions) {
          await page.locator(action.click).click({ timeout: timeoutMs });
          if (new URL(page.url()).origin !== origin.origin) throw new Error('Ação saiu da origem de testes');
          await page.locator(action.expect_visible).waitFor({ state: 'visible', timeout: timeoutMs });
        }
      } catch (error) {
        errors.push(brief(error));
      } finally {
        if (page) {
          try { await page.close(); } catch (error) { errors.push(`fechamento: ${brief(error)}`); }
        }
      }
      results.push({ id: scenario.id, status: errors.length ? 'fail' : 'pass', errors });
    }
  } finally {
    try { await browser.close(); } catch { /* o processo de teste já terminou */ }
  }
  return { schema_version: 1, status: results.some((item) => item.status === 'fail') ? 'fail' : 'pass',
    started_at, finished_at: new Date().toISOString(), results };
}
