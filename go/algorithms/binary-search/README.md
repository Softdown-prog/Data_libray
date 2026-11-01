# Busca binária: primeira ocorrência

Encontra a primeira ocorrência em uma sequência crescente; devolve (-1, false) quando ausente.

**Linguagem:** go · **Categoria:** algorithms · **ID:** `go.algorithms.binary-search`

## Executar

```bash
cd go && go test ./algorithms/binary-search
```

## Validar

```bash
cd go && go test -race ./algorithms/binary-search
```

Complexidade: O(log n) em tempo, O(1) em memória. A entrada precisa estar ordenada.
