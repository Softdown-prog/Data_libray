
/**
 * Data Library ID: angular.web.cluster-status-polling
 * Propósito: consumir estado remoto via polling reativo de 6 segundos.
 * Quando usar: painel administrativo Angular que precisa de leitura periódica.
 * Quando evitar: dados em tempo real crítico, onde streaming/WebSocket é mais apropriado.
 * Erros: resposta inválida ou HTTP com falha mantém último estado, sem exibir SECURE fictício.
 * Correções: README.md e example.json; requer provideHttpClient() no bootstrap.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { EMPTY, timer, timeout } from 'rxjs';
import { catchError, exhaustMap } from 'rxjs/operators';

type MemoryHealth = 'SECURE' | 'WARNING' | 'CRITICAL';

interface ClusterStatus {
  readonly activeWorkers: number;
  readonly memoryHealth: MemoryHealth;
}

/** O tipo do HTTP não valida JSON: verifique explicitamente os campos antes de usar. */
function isClusterStatus(value: unknown): value is ClusterStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['activeWorkers'] === 'number'
    && Number.isSafeInteger(candidate['activeWorkers'])
    && candidate['activeWorkers'] >= 0
    && (
      candidate['memoryHealth'] === 'SECURE'
      || candidate['memoryHealth'] === 'WARNING'
      || candidate['memoryHealth'] === 'CRITICAL'
    );
}

@Component({
  selector: 'dl-cluster-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Estado do cluster">
      <h2>Estado do cluster</h2>
      @if (status(); as current) {
        <p>Workers ativos: <strong>{{ current.activeWorkers }}</strong></p>
        <p>Saúde reportada: <strong>{{ current.memoryHealth }}</strong></p>
      } @else {
        <p>Aguardando dados confirmados do servidor.</p>
      }
      @if (error(); as message) {
        <p role="alert">{{ message }}</p>
      }
    </section>
  `,
})
export class ClusterDashboardComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<ClusterStatus | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    timer(0, 6000).pipe(
      exhaustMap(() => this.http.get<unknown>('/api/cluster/status').pipe(
        timeout({ first: 5000 }), // Libera o próximo ciclo se a rede ficar suspensa.
        catchError(() => {
          this.error.set('Não foi possível consultar o estado do cluster.');
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((payload: unknown) => {
      if (!isClusterStatus(payload)) {
        this.error.set('O gateway devolveu um estado inválido.');
        return;
      }
      this.status.set(payload);
      this.error.set(null);
    });
  }
}
