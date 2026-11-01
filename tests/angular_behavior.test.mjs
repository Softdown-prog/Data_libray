/**
 * Testes de comportamento Angular sem navegador:
 * signals, serviço de URL, injeção de dependências e HTTP mockado.
 * "pass" aqui não equivale a ter testado a interface no DOM.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const angularDir = resolve(here, '../angular');
const angularRequire = createRequire(resolve(angularDir, 'package.json'));
const external = async (name) => import(pathToFileURL(angularRequire.resolve(name)).href);
const compiled = async (path) =>
  import(pathToFileURL(resolve(angularDir, '.behavior-dist', path)).href);

const ids = [
  'angular.ui.accessible-toggle',
  'angular.web.cluster-status-polling',
  'angular.web.query-param-service',
];
const selected = process.argv[2] ?? 'all';
if (selected !== 'all' && !ids.includes(selected)) {
  throw new Error('ID Angular não possui teste de comportamento: ' + selected);
}

if (selected === 'all' || selected === ids[0]) {
  test('angular.ui.accessible-toggle alterna signal e mantém estado', async () => {
    const { AccessibleToggleComponent } = await compiled('ui/accessible-toggle/toggle.component.js');
    const component = new AccessibleToggleComponent();
    assert.equal(component.pressed(), false);
    component.toggle();
    assert.equal(component.pressed(), true);
    component.toggle();
    assert.equal(component.pressed(), false);
  });
}

if (selected === 'all' || selected === ids[2]) {
  test('angular.web.query-param-service valida URLs e parâmetros', async () => {
    const { QueryParamService } = await compiled('web/query-param-service/query-param.service.js');
    const service = new QueryParamService();
    assert.equal(service.read('https://example.test/?q=ola%20mundo', 'q'), 'ola mundo');
    assert.equal(service.read('https://example.test/?q=', 'q'), '');
    assert.equal(service.read('https://example.test/', 'q'), null);
    assert.throws(() => service.read('https://example.test/', ' '), TypeError);
    assert.throws(() => service.read('javascript:alert(1)', 'q'), TypeError);
    assert.throws(() => service.read('file:///etc/passwd', 'q'), TypeError);
    assert.throws(() => service.read('url-invalida', 'q'), TypeError);
  });
}

if (selected === 'all' || selected === ids[1]) {
  test('angular.web.cluster-status-polling testa HTTP válido, inválido e falha', async (t) => {
    const [{ Injector, createEnvironmentInjector, runInInjectionContext },
      { provideHttpClient },
      { provideHttpClientTesting, HttpTestingController },
      { ClusterDashboardComponent }] = await Promise.all([
      external('@angular/core'),
      external('@angular/common/http'),
      external('@angular/common/http/testing'),
      compiled('web/cluster-status-polling/cluster-dashboard.component.js'),
    ]);

    const start = async () => {
      const injector = createEnvironmentInjector(
        [provideHttpClient(), provideHttpClientTesting()],
        Injector.NULL,
      );
      const component = runInInjectionContext(injector, () => new ClusterDashboardComponent());
      const controller = injector.get(HttpTestingController);
      // timer(0, 6000) emite no próximo ciclo do event loop; não esperamos 6 segundos.
      const request = await new Promise((resolveRequest, reject) => {
        let tries = 0;
        const check = () => {
          const matches = controller.match('/api/cluster/status');
          if (matches.length > 0) {
            resolveRequest(matches[0]);
          } else if (++tries > 40) {
            reject(new Error('Polling inicial não abriu a requisição HTTP'));
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });
      return { injector, component, controller, request };
    };

    await t.test('resposta válida atualiza signals', async () => {
      const env = await start();
      try {
        assert.equal(env.component.status(), null);
        env.request.flush({ activeWorkers: 3, memoryHealth: 'WARNING' });
        assert.equal(env.component.status()?.activeWorkers, 3);
        assert.equal(env.component.status()?.memoryHealth, 'WARNING');
        assert.equal(env.component.error(), null);
        env.controller.verify();
      } finally {
        env.injector.destroy();
      }
    });

    await t.test('resposta inválida não publica estado de saúde fictício', async () => {
      const env = await start();
      try {
        env.request.flush({ activeWorkers: -1, memoryHealth: 'SECURE' });
        assert.equal(env.component.status(), null);
        assert.match(env.component.error() ?? '', /inválido/);
        env.controller.verify();
      } finally {
        env.injector.destroy();
      }
    });

    await t.test('falha HTTP produz alerta sem atualizar status', async () => {
      const env = await start();
      try {
        env.request.flush('indisponível', { status: 503, statusText: 'Unavailable' });
        assert.equal(env.component.status(), null);
        assert.match(env.component.error() ?? '', /Não foi possível consultar/);
        env.controller.verify();
      } finally {
        env.injector.destroy();
      }
    });
  });
}
