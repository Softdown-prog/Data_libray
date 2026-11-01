# Despachante concorrente com reserva atômica de capacidade em Rust

**ID:** `rust.concurrency.bounded-dispatcher` · **Categoria:** concurrency · **Linguagem:** rust · **Estado:** documented

## Objetivo e comportamento

Permite executar tarefas independentes com limite de threads simultâneas usando reserva CAS e liberação do slot por Drop mesmo quando uma tarefa entra em panic.

## Quando usar

Use para lotes pequenos de tarefas CPU/bloqueantes cujas threads não precisam ser reaproveitadas, quando é necessário recusar novas tarefas durante a saturação.

## Quando não usar

Não use para filas persistentes, milhões de conexões, executor async, pool com reuso de threads, tarefas de terceiros sem isolamento ou dimensionamento automático de cluster.

## Pré-requisitos

- Rust estável com edition 2021 e biblioteca padrão.
- max_capacity > 0 para permitir iniciar qualquer tarefa.
- Chamador deve reter JoinHandle se quiser observar panic e aguardar conclusão.

## Entradas

- new(max_capacity: u32) define limite simultâneo de tarefas.
- dispatch(F) recebe closure FnOnce() + Send + 'static.
- active_load() fornece leitura instantânea do contador.

## Saídas

- dispatch retorna JoinHandle em sucesso ou DispatchError::AtCapacity / Spawn(io::Error) em falha.
- active_load retorna número de slots reservados ou ainda ativos, não telemetria global da VPS.
- Após conclusão ou panic, ActiveWorkerGuard retorna o slot ao limite disponível.

## Exemplo de utilização

```rust
let dispatcher = SystemDispatcher::new(2);
let worker = dispatcher.dispatch(|| println!("tarefa")).expect("slot disponível");
worker.join().expect("worker sem panic");
assert_eq!(dispatcher.active_load(), 0);
```

## Executar ou integrar

cd rust && cargo test -p bounded-dispatcher-example

## Testar

```bash
cd rust && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p bounded-dispatcher-example
```

## Tratamento de erros

- CAS impede a corrida entre load e fetch_add presente no trecho original.
- Se thread::Builder falhar, a reserva já feita é revertida antes de retornar erro.
- Se task panicar, Drop decrementa o contador; JoinHandle::join retorna Err para o chamador.
- Capacidade zero recusa sempre: sem overflow de AtomicU32.

## Limitações e riscos

- Cada tarefa cria thread de SO: há custo de criação e memória; não é thread pool.
- O contador mede só este dispatcher e não saúde real da memória ou total de workers em outros processos.
- panic=abort ou encerramento abrupto do processo impedem execução de Drop.
- Não contém persistência, autenticação, cancelamento ou isolação entre clientes.

## Diagnóstico e correção

### 1. O despacho retorna AtCapacity quando vários chamadores chegam ao mesmo tempo.

**Causa:** Todos os slots foram reservados por tarefas em andamento, e o método não implementa enfileiramento.

**Correção:** Aguarde os handles retornados ou implemente fila com backpressure; não incremente o limite sem medir recursos.

### 2. O worker entra em panic e o processo não recebe a causa ao chamar dispatch.

**Causa:** O erro da closure é observado no JoinHandle::join, não no retorno de dispatch.

**Correção:** Armazene o JoinHandle e verifique join(); use tratamento de panic dentro da tarefa quando necessário.

## Verificação automatizada

**Nível:** automated-tests

**Escopo:** cargo fmt, clippy -D warnings e testes de capacidade zero, saturação, recuperação após panic e submissões simultâneas por 32 threads.

**Lacunas:** Falha de criação de thread do sistema operacional não é simulada; não é benchmark de desempenho nem prova de operação em cluster distribuído.

## Arquivos catalogados

- `Cargo.toml` — config
- `src/lib.rs` — source

## Origem e manutenção

Adaptação original baseada no kit fornecido para esta biblioteca, com correções e limites explícitos. Alterações de assinatura, efeitos ou comportamento exigem atualizar código, testes, README e índice no mesmo commit. A classificação documented **não significa ausência de defeitos**.
