# Leitura segura de query params Angular

Serviço injetável que lê um parâmetro de uma URL absoluta e normaliza o resultado.

**Linguagem:** angular · **Categoria:** web · **ID:** `angular.web.query-param-service`

## Executar

```bash
Injete QueryParamService e chame read('https://site.test/?q=ok', 'q').
```

## Validar

```bash
cd angular && npx ngc -p tsconfig.json
```

Validação atual: compilação Angular estrita; a função exige URL absoluta e lança exceção para URL malformada.
