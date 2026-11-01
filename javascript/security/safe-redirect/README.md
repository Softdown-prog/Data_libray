# Redirecionamento de mesma origem

**ID:** javascript.security.safe-redirect · **Linguagem:** JavaScript · **Categoria:** security · **Estado:** documented

## Objetivo e comportamento

Converte um caminho ou URL de entrada em endereço canônico absoluto somente quando seu destino pertence exatamente à origem HTTP(S) confiável configurada para a aplicação, sem realizar navegação.

## Quando usar

Use quando gerar destinos para links ou redirecionamentos que devem ficar na mesma origem confiável, antes de passar a URL validada para a camada de navegação do aplicativo.

## Quando não usar

Não use como substituto de autenticação, autorização, allowlist de rotas, proteção contra um endpoint da mesma origem que redireciona novamente ou para aceitar uma origem fornecida pelo visitante.

## Pré-requisitos

- Node.js 24 para os testes, suporte a ES Modules e API nativa WHATWG URL; nenhum pacote npm é necessário.
- A origem vem de configuração confiável e contém apenas esquema http(s), host e porta opcional, sem caminho, query, hash ou credenciais.
- Em produção com dados sensíveis utilize HTTPS; HTTP é aceito para cenários explícitos como desenvolvimento local.

## Entradas

- candidate deve ser string não vazia sem caracteres de controle, barras invertidas, espaços nas extremidades ou prefixo de duas barras.
- origin deve ser origem HTTP(S) absoluta e confiável; o resultado é comparado pela propriedade URL.origin, que inclui protocolo, host e porta.

## Saídas

- Retorna a URL canônica absoluta no formato string quando a origem do destino coincide exatamente e não existem credenciais incorporadas.
- Não faz chamadas HTTP, não navega e não autoriza recursos ou rotas; a execução do redirecionamento depende do chamador.

## Exemplo de utilização

```javascript
import { sameOriginUrl } from './index.mjs';
const link = sameOriginUrl('/account', 'https://example.com');
// link === 'https://example.com/account'; a navegação deve exigir política de rota.
```

## Executar ou integrar

A partir da raiz do repositório, execute o exemplo por testes ou importe a função no seu aplicativo. A função retorna uma string sem realizar navegação:

```bash
node javascript/security/safe-redirect/index.test.mjs
```

## Testar

```bash
node --test javascript/security/safe-redirect/index.test.mjs
node --check javascript/security/safe-redirect/index.mjs
node --check javascript/security/safe-redirect/index.test.mjs
```

## Tratamento de erros

- TypeError ao receber origem ausente, de tipo inválido, não HTTP(S), com credenciais, caminho, query, fragmento ou URL malformada.
- TypeError para destinos externos, protocolos diferentes, URL com userinfo ou string ambígua contendo controles, backslash ou barras duplas iniciais.
- A exceção nativa TypeError do construtor URL também é propagada; rejeite a solicitação em vez de adotar destino externo como fallback.

## Limitações e riscos

- Ser da mesma origem não garante que o usuário esteja autorizado a acessar determinada rota nem que os parâmetros da rota sejam seguros.
- Um endpoint da mesma origem pode responder com redirecionamento HTTP para outro site; esta função não segue respostas nem valida um parâmetro next.
- URLs com sequências percent-encoded podem receber diferentes decodificações em proxies e backends; isso não constitui validação de caminho de arquivo.
- HTTP permanece permitido para desenvolvimento local, mas uma implantação de produção deve usar HTTPS de confiança.
- A origem base deve ser apenas a origem; URL base com caminho, hash ou query é rejeitada intencionalmente para eliminar resolução ambígua.

## Diagnóstico e correção

### Caso 1: Um subdomínio, porta diferente ou mudança de http para https foi rejeitada mesmo parecendo ser o mesmo site.

**Causa:** A política compara protocolo, host e porta efetiva usando URL.origin, e cada combinação é uma origem distinta.

**Correção:** Forneça a origem exata da aplicação; caso múltiplas origens sejam realmente necessárias, implemente uma allowlist explícita e auditada.

### Caso 2: A chamada com origin https://example.com/app é rejeitada com erro de origem base inválida.

**Causa:** A função aceita somente uma origem pura, sem caminho ou parâmetros que alterem a resolução do destino relativo.

**Correção:** Passe https://example.com como origem e informe /app ou a rota pretendida como candidate após verificar a autorização.

### Caso 3: Uma URL de /redirect contendo next com domínio externo foi permitida apesar de poder levar para fora.

**Causa:** A verificação valida a primeira URL, mas não avalia parâmetros da rota nem redirecionamentos emitidos pelo servidor.

**Correção:** Valide separadamente a rota e parâmetros como next, e evite redirecionamentos encadeados sem verificação em cada etapa.

## Verificação automatizada

**Nível:** automated-tests

**Escopo:** node --check no parser e node --test no GitHub Actions; testes de sucesso, normalização, origens parecidas, credenciais, esquemas perigosos, controles e limites de redirecionamento.

**Lacunas:** Não inspeciona respostas HTTP, não tem testes de navegador ou proxies com dupla decodificação, nem oferece certificação formal de segurança.

## Arquivos catalogados

- `index.mjs` — source
- `index.test.mjs` — test
- `example.json` — metadados v2
- `README.md` — manual técnico

## Origem e manutenção

Exemplo original desta biblioteca, revisado para uma política explícita de origem confiável HTTP(S), com testes de entradas adversariais e limitações declaradas. Mudanças devem atualizar código, testes, metadados, catálogo e documentação no mesmo commit. O estado documented não significa certificação para produção.
