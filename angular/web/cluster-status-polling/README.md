# Painel Angular reativo para status remoto com validação runtime

**ID:** `angular.web.cluster-status-polling` · **Categoria:** web · **Linguagem:** angular · **Estado:** documented

## Objetivo e comportamento

Componente Angular standalone que consulta uma API de status a cada 6 segundos, verifica os dados recebidos e atualiza signals sem produzir estado SECURE fictício.

## Quando usar

Use em dashboards internos Angular para exibir métricas já fornecidas por um backend autenticado e com contrato claro de resposta.

## Quando não usar

Evite para métricas críticas de baixa latência, interfaces públicas sem endpoint confiável ou cenários que requerem streaming contínuo; prefira SSE ou WebSocket quando apropriado.

## Pré-requisitos

- Angular 22 e TypeScript 6.0 com strictTemplates habilitado.
- provideHttpClient() configurado no bootstrap Angular.
- Endpoint GET /api/cluster/status responde JSON com activeWorkers inteiro seguro >= 0 e memoryHealth SECURE|WARNING|CRITICAL.

## Entradas

- GET /api/cluster/status: resposta do servidor tipada inicialmente como unknown.
- Nenhuma propriedade de componente é exigida; polling imediato e depois a cada seis segundos.

## Saídas

- status signal: ClusterStatus|null, começando em null até primeira resposta validada.
- error signal: mensagem resumida de falha HTTP ou payload inválido; limpa quando resposta válida chega.
- Template renderiza número de workers e saúde apenas quando há resposta válida.

## Exemplo de utilização

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = { providers: [provideHttpClient()] };
// Host standalone: imports: [ClusterDashboardComponent]
// Template host: <dl-cluster-dashboard />
```

## Executar ou integrar

Importe ClusterDashboardComponent em um host standalone; configure provideHttpClient() no bootstrap e uma API GET /api/cluster/status.

## Testar

```bash
cd angular && npx ngc -p tsconfig.json
```

## Tratamento de erros

- Resposta malformada não atualiza status nem inventa saúde SECURE; mostra alerta de erro.
- Erro HTTP é capturado dentro do exhaustMap, permitindo que consultas futuras continuem.
- takeUntilDestroyed encerra a inscrição quando o componente é destruído.
- exhaustMap evita múltiplos requests sobrepostos, descartando ticks enquanto uma requisição ainda está em andamento.

## Limitações e riscos

- Somente exibe números reportados pela API; não mede memória por conta própria.
- É necessário garantir autenticação, autorização, limitação de taxa e CORS no backend real.
- Em erro após sucesso o último estado fica preservado na tela, potencialmente desatualizado, acompanhado de alerta.
- Não há backoff exponencial, testes DOM nem garantia de atualização instantânea.

## Diagnóstico e correção

### 1. Angular lança NullInjectorError para HttpClient ao abrir o painel.

**Causa:** O aplicativo host esqueceu de registrar o provedor de HTTP no bootstrap.

**Correção:** Configure provideHttpClient() em app.config.ts ou providers do bootstrapApplication antes de usar o componente.

### 2. A interface informa que o gateway devolveu um estado inválido.

**Causa:** A API está enviando chaves diferentes, memoryHealth fora do enum ou activeWorkers não inteiro.

**Correção:** Alinhe o contrato JSON de resposta e valide o retorno real do gateway, sem usar cast de tipo que elimine a checagem.

## Verificação automatizada

**Nível:** compile-only

**Escopo:** ngc -p angular/tsconfig.json com strictTemplates, tipagem estrita do componente e checagem estrutural pelo catalogador v2.

**Lacunas:** Não foram executados testes de DOM, timer virtual, HTTP mock, integração real com gateway nem verificação de acessibilidade no navegador.

## Arquivos catalogados

- `cluster-dashboard.component.ts` — source

## Origem e manutenção

Adaptação original baseada no kit fornecido para esta biblioteca, com correções e limites explícitos. Alterações de assinatura, efeitos ou comportamento exigem atualizar código, testes, README e índice no mesmo commit. A classificação documented **não significa ausência de defeitos**.
