# Busca binária: primeira ocorrência

**ID estável:** `go.algorithms.binary-search`  
**Linguagem:** Go · **Categoria:** algorithms · **Estado:** documentação técnica v2

## Objetivo e comportamento

Encontra a primeira ocorrência de target em um slice de números inteiros ordenado em ordem crescente, inclusive quando há duplicatas, devolvendo um índice seguro e um indicador de sucesso.

## Quando usar

Use em consultas repetidas a dados que já estão ordenados quando for importante saber a primeira posição de um valor, por exemplo a ocorrência inicial de uma faixa de registros iguais.

## Quando não usar

Não use sobre slices desordenados, dados alterados durante a consulta ou quando a preservação da ordem original impedir uma classificação prévia; nesses casos use busca linear ou uma estrutura de índice apropriada.

## Pré-requisitos

- Go 1.23+ (módulo go/go.mod).
- Os inteiros de entrada devem estar em ordem não decrescente.
- A função não depende de rede, banco ou pacotes externos.

## Entradas

- sorted []int: slice de inteiros previamente ordenados, podendo ser nil ou vazio.
- target int: número inteiro a pesquisar, com valores positivos, negativos ou zero.

## Saídas

- Retorna (i, true) quando encontra target; i é o índice da primeira ocorrência (base zero).
- Retorna (-1, false) quando não encontra o valor; nunca retorna índice válido com false.
- Não altera o slice recebido e usa O(log n) de tempo e O(1) de espaço adicional.

## Exemplo de utilização

```go
values := []int{1, 2, 2, 2, 9}
index, found := FirstIndex(values, 2) // index = 1; found = true
missing, ok := FirstIndex(values, 7) // missing = -1; ok = false
```

A função está no pacote `binarysearch`; importe-o na aplicação consumidora ou copie a implementação juntamente com seus testes, respeitando a licença escolhida pelo mantenedor do repositório.

## Executar ou integrar

```bash
cd go && go test ./algorithms/binary-search
```

## Testar

```bash
cd go && go test -race ./algorithms/binary-search
cd go && go vet ./...
```

## Tratamento de erros

- Slice nil ou vazio: retorno (-1, false), sem panic.
- Alvo ausente, abaixo do mínimo ou acima do máximo: retorno (-1, false).
- Não existe validação automática da pré-condição de ordenação; resultados incorretos podem ocorrer para entrada desordenada.

## Limitações e riscos

- A ordenação é responsabilidade de quem chama a função; o compilador e o teste não verificam esse contrato em runtime.
- Implementação especializada para []int, sem comparador para tipos customizados.
- O slice deve permanecer estável durante a busca; alterações concorrentes sem sincronização podem causar data races.

## Diagnóstico e correção

### Caso 1

**Sintoma:** A função retorna -1 mesmo que o valor pareça estar no slice.

**Causa provável:** O slice não está ordenado ou foi modificado durante a pesquisa.

**Correção:** Confirme a ordenação; quando necessário crie uma cópia e execute sort.Ints na cópia antes de buscar.

### Caso 2

**Sintoma:** O resultado aponta para a primeira duplicata e não para a última.

**Causa provável:** O algoritmo deliberadamente mantém o intervalo à esquerda em comparações de igualdade.

**Correção:** Se precisar da última ocorrência, implemente busca de limite superior separadamente; não altere o contrato deste exemplo.

## Verificação automatizada

**Nível:** automated-tests

**Cobertura:** go test -race -count=1 ./... e go vet ./...; testes de entrada vazia, única, duplicatas, negativos e alvos ausentes.

**Lacunas:** Não há validação dinâmica da ordenação nem testes de acesso concorrente; esta função não fornece sincronização.

## Arquivos catalogados

- `binary_search.go` — implementação
- `binary_search_test.go` — testes e casos de borda
- `example.json` — metadados e especificação v2
- `README.md` — documentação de uso e diagnóstico

## Origem e manutenção

Implementação original preparada para a Data Library. Alterações na assinatura ou comportamento requerem atualização simultânea do código, testes, README e catálogo. Código compilado e aprovado nos testes ainda não é garantia de ausência de defeitos.
