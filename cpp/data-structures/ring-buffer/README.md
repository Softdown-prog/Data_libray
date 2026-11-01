# Buffer circular C++20

Fila de capacidade fixa, com inserção e remoção seguras e sem alocação dinâmica.

**Linguagem:** cpp · **Categoria:** data-structures · **ID:** `cpp.data-structures.ring-buffer`

## Executar

```bash
g++ -std=c++20 cpp/data-structures/ring-buffer/main.cpp -o /tmp/ring_buffer && /tmp/ring_buffer
```

## Validar

```bash
CI: g++ -std=c++20 -Wall -Wextra -Wpedantic -Werror -fsanitize=undefined
```

A implementação exige T default-constructible e copiável; não é segura para múltiplas threads sem sincronização.
