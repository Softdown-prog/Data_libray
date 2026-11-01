import { chromium } from 'playwright';
import { browserContract } from './browser-contract.mjs';
import { serveArtifact } from './artifact-server.mjs';
let browser, server;
const close = async () => { try { await browser?.close(); } catch {} try { await server?.close(); } catch {} };
process.on('SIGTERM', async () => { await close(); process.exit(1); });
process.once('message', async input => {
  let result = { status: 'infra-error', executed: false, code: 'browser-infrastructure', cases: [] };
  try {
    const contract = browserContract(input.contract);
    server = await serveArtifact(input);
    browser = await chromium.launch({ headless: true, timeout: 15000, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    result = { status: 'pass', executed: true, code: 'chromium-contract-executed', cases: [] };
    for (const scenario of contract.cases) {
      const codes = new Set();
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, permissions: [] });
      const expected = server.origin + input.mount + scenario.path.slice(1);
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== server.origin || !url.pathname.startsWith(input.mount) || !['GET', 'HEAD'].includes(request.method()) || (request.isNavigationRequest() && request.url() !== expected)) {
          codes.add('network-policy-blocked'); await route.abort(); return;
        }
        await route.continue();
      });
      await context.routeWebSocket('**/*', ws => { codes.add('websocket-blocked'); ws.close(); });
      const page = await context.newPage();
      context.on('page', popup => { codes.add('popup-blocked'); void popup.close().catch(() => {}); });
      page.on('pageerror', () => codes.add('application-pageerror'));
      page.on('console', msg => { if (msg.type() === 'error') codes.add('application-console-error'); });
      page.on('response', response => { if (response.status() >= 400) codes.add('http-error'); });
      page.on('requestfailed', () => codes.add('request-failed'));
      try {
        const response = await page.goto(expected, { waitUntil: 'networkidle', timeout: contract.timeout_ms });
        if (!response || response.status() !== 200 || page.url() !== expected) throw new Error();
        await page.locator(input.host).waitFor({ state: 'visible', timeout: contract.timeout_ms });
        if (!await page.locator(input.host).getAttribute('ng-version')) { codes.add('angular-bootstrap-unverified'); throw new Error(); }
        for (const selector of scenario.expect_visible) await page.locator(selector).waitFor({ state: 'visible', timeout: contract.timeout_ms });
        for (const action of scenario.actions) {
          if (await page.locator(action.expect_visible).isVisible()) { codes.add('no-observable-transition'); throw new Error(); }
          await page.locator(action.click).click({ timeout: contract.timeout_ms });
          await page.locator(action.expect_visible).waitFor({ state: 'visible', timeout: contract.timeout_ms });
          if (page.url() !== expected) { codes.add('unexpected-navigation'); throw new Error(); }
        }
        await page.waitForTimeout(100); // bounded drain for queued browser errors
      } catch { codes.add('required-assertion-failed'); }
      finally { await context.close(); }
      result.cases.push({ id: scenario.id, status: codes.size ? 'fail' : 'pass', codes: [...codes].sort() });
    }
    if (result.cases.some(c => c.status !== 'pass')) result.status = 'fail';
  } catch { result = { status: 'infra-error', executed: false, code: 'browser-infrastructure', cases: [] }; }
  finally { await close(); }
  process.send?.(result, () => process.exit(0));
});
