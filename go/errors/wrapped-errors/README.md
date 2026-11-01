# Erros Go encadeados

Encadeia falhas usando fmt.Errorf com %w e identifica a causa por errors.Is.

**Linguagem:** go · **Categoria:** errors · **ID:** `go.errors.wrapped-errors`

## Executar

```bash
cd go && go test ./errors/wrapped-errors
```

## Validar

```bash
cd go && go test -race ./errors/wrapped-errors
```

**Observação:** este exemplo é independente dos demais e deve permanecer pequeno, legível e reproduzível.
