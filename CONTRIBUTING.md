# Contribuindo com a Data Library

1. Escolha a linguagem, categoria e um problema **concreto**. Evite duplicar algoritmos sem diferença de comportamento relevante.
2. Crie `linguagem/categoria/nome-do-exemplo/` com código executável, `example.json`, `README.md`, teste/checagem.
3. Use IDs estáveis `linguagem.categoria.nome-do-exemplo`. Não renomeie um ID já publicado sem uma migração documentada.
4. Descreva pré-requisitos, como rodar, como testar, limites, complexidade quando relevante e exemplo de entrada/saída.
5. Execute `python scripts/catalog.py --write` para atualizar o catálogo e `python scripts/catalog.py --check`.
6. Rode a verificação da sua linguagem. Nenhum teste deve depender de internet, segredos, dados pessoais ou infraestrutura externa.
7. Envie um pull request pequeno; o CI deverá passar antes do merge.

**Segurança:** exemplos não devem incluir chaves, tokens, credenciais nem executar comandos perigosos automaticamente. Não incorporar código de terceiros sem licença compatível e atribuição.

**Confiabilidade:** mantenha testes de casos normais, vazios, limites e falhas esperadas. Prefira módulos autônomos, com dependências mínimas.

**Contagem:** um exemplo é uma solução única, não cada arquivo. A contagem oficial vem de `catalog.json`. Nunca marcar exemplos como verificados sem a execução correspondente.
