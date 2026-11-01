# Conversão segura de inteiro Java

Trata entrada nula, vazia e inválida retornando OptionalInt, sem ocultar NumberFormatException.

**Linguagem:** java · **Categoria:** errors · **ID:** `java.errors.safe-integer-parse`

## Executar

```bash
javac java/errors/safe-integer-parse/Main.java && java -cp java/errors/safe-integer-parse Main
```

## Validar

```bash
CI: javac -Xlint:all -Werror && java -ea Main
```

Quando for necessário diferenciar número inválido de ausência do valor, use um resultado tipado mais expressivo que OptionalInt.
