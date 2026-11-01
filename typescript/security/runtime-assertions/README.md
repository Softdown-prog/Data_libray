# Asserções de tipos e valores não nulos em TypeScript

**ID:** `typescript.security.runtime-assertions` · **Categoria:** security · **Linguagem:** typescript · **Estado:** documented

## Objetivo e comportamento

Fornece assertType<T> e assertNonNullable<T> para impedir que valores desconhecidos sejam usados como tipados sem uma verificação de runtime explícita.

## Quando usar

Use nas bordas do sistema: JSON de API, eventos de fila, arquivos de configuração, mensagens entre serviços e entrada de usuário antes de confiar no tipo.

## Quando não usar

Não substitui validação de esquema profundo, regras de negócio, autorização ou saneamento; não confunda type guard mal escrito com dado confiável.

## Pré-requisitos

- TypeScript 6.0 em strict mode com noUncheckedIndexedAccess e demais opções do tsconfig.strict.json.
- Um predicado real de validação (value is T), capaz de analisar propriedades e restrições sem fazer cast inseguro.

## Entradas

- assertType(value: unknown, validator: (value: unknown) => value is T, errorMessage: string).
- assertNonNullable(value: T, fieldName: string) para valor que pode ser nulo ou indefinido.

## Saídas

- Quando válido, assertions estreitam o tipo estático para o código seguinte.
- Quando inválido, lançam CodeRigidityError com contexto específico para tratamento no chamador.

## Exemplo de utilização

```typescript
const payload: unknown = JSON.parse('{"requestId":"abc","retries":0}');
assertType(payload, isGatewayPayload, 'Payload inválido');
// Só use payload.requestId após a validação real do predicado.
```

## Executar ou integrar

tsc -p typescript/security/runtime-assertions/tsconfig.strict.json

## Testar

```bash
tsc -p typescript/tsconfig.json && node --test typescript/dist
```

## Tratamento de erros

- Um validator que retorna false causa CodeRigidityError, que deve ser capturado na fronteira HTTP/queue e traduzido para erro de domínio.
- null e undefined são rejeitados; string vazia, NaN, array vazio e dados semanticamente incorretos exigem outras validações.
- Se o validator lançar exceção própria, ela é propagada: não é convertida automaticamente em CodeRigidityError.

## Limitações e riscos

- assertType depende inteiramente da qualidade do type guard; TypeScript não valida JSON em runtime sozinho.
- Não registra logs, não autentica requisições e não sanitiza entradas.
- assertNonNullable não verifica strings vazias, NaN nem estruturas profundas.

## Diagnóstico e correção

### 1. Um objeto desconhecido passa pela asserção mesmo com campos incorretos.

**Causa:** O predicado foi escrito como retorno constante true ou usou cast sem inspeção de valores.

**Correção:** Implemente o type guard verificando cada propriedade obrigatória, tipos, limites e casos inválidos; adicione testes negativos.

### 2. Um valor string vazia passa por assertNonNullable apesar de ser proibido pela regra de negócio.

**Causa:** Esta asserção só elimina null e undefined, não impõe uma política de string.

**Correção:** Crie validator próprio para strings não vazias e chame assertType com a regra de domínio.

## Verificação automatizada

**Nível:** automated-tests

**Escopo:** tsc strict em dois tsconfigs e execução com node --test de entradas válidas, nullish, inteiros inválidos e mensagem do erro.

**Lacunas:** Não cobre comportamento de gateway HTTP, autenticação, dados encadeados ou consumo via browser; exige revisão dos predicados criados pelo projeto.

## Arquivos catalogados

- `index.ts` — source
- `index.test.ts` — test
- `tsconfig.strict.json` — config

## Origem e manutenção

Adaptação original baseada no kit fornecido para esta biblioteca, com correções e limites explícitos. Alterações de assinatura, efeitos ou comportamento exigem atualizar código, testes, README e índice no mesmo commit. A classificação documented **não significa ausência de defeitos**.
