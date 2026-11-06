# SAC Multistack — NestJS 11 (fixture sintética)

O perfil declarativo `nestjs` já está presente no registry. Esta microetapa
ativa provas **de primeira parte** com o CLI NestJS 11, TypeScript e Supertest.

A fixture contém uma rota real `GET /health` num controller decorado,
um `AppModule` e uma fábrica de aplicação Nest. Não existe serviço persistente:
Supertest solicita um servidor local apenas em `127.0.0.1` dentro do
runner descartável. O CI instala dependências com `--ignore-scripts`,
sem executar os scripts arbitrários do package.json.

As provas exigem:
1. `tsc --noEmit` aprova o código correto;
2. substituir o retorno `string` por `number` produz **TS2322**;
3. restaurar código e executar o CLI oficial `nest build`;
4. a rota HTTP devolve `200` e JSON `{"status":"ok"}`;
5. uma alteração de retorno para `"regressed"` **também compila**;
6. nova compilação e requisição HTTP devem observar `"regressed"`, que
   constitui uma regressão semântica detectável por uma asserção que exigisse
   `"ok"`, mesmo com status HTTP 200 e build aprovado.

O resultado factual não contém log livre, stack trace ou dados do projeto:
apenas ferramentas, fases e códigos conhecidos. `deployment_authorized=false`.
Este teste **não** executa projetos externos, não permite deploy, não altera
o Worker/Painel e não substitui auditoria de backend num Docker isolado.
A imagem, dependências transitivas e isolamento de processos para projetos
não confiáveis ainda precisam de homologação em etapa posterior.
