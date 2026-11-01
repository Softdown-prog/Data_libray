# Busca binária C++20

Localiza a primeira ocorrência de um valor em vector ordenado usando limites semiabertos.

**Linguagem:** cpp · **Categoria:** algorithms · **ID:** `cpp.algorithms.binary-search`

## Executar

```bash
g++ -std=c++20 cpp/algorithms/binary-search/main.cpp -o /tmp/binary_search && /tmp/binary_search
```

## Validar

```bash
CI: g++ -std=c++20 -Wall -Wextra -Wpedantic -Werror -fsanitize=undefined
```

Complexidade O(log n) em tempo e O(1) em espaço; requer vector ordenado.
