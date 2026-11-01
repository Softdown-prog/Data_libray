# Redirecionamento de mesma origem

Valida URLs de destino contra uma origem fixa antes de navegar, bloqueando URLs externas.

**Linguagem:** javascript · **Categoria:** security · **ID:** `javascript.security.safe-redirect`

## Executar

```bash
node javascript/security/safe-redirect/index.test.mjs
```

## Validar

```bash
node --test javascript/security/safe-redirect/index.test.mjs
```

Use a origem de confiança do seu aplicativo, nunca um valor controlado pelo visitante.
