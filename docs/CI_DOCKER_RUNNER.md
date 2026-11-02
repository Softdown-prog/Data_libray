# Data Library — GitHub Actions self-hosted em Docker (pré-homologação)

## Estado

O workflow `.github/workflows/validate-library.yml` exige os rótulos
`self-hosted`, `linux`, `x64`, `data-library-docker`. Cada um dos nove jobs
executa suas ferramentas em `jobs.<job>.container`, com limite de 2 CPUs,
2 GiB de RAM e 256 processos no **container do job**.

**Somente o YAML foi preparado.** Publicar código não instala nem registra
o runner. Não há comprovação de que a VPS tenha um runner com esses rótulos.
Enquanto ele não estiver disponível, os jobs continuarão `queued`.
Um resultado de testes antigos em GitHub-hosted não homologa a execução local.

## Separação na VPS multiprojetos

- O supervisor de catálogo `data-library-worker.service` permanece separado,
  sem grupo `docker`, sem socket e sem mudança nas suas permissões.
- O executor do SAC/Guardian descrito em `docs/SAC_ROOTLESS_EXECUTOR.md`
  também é **outro serviço** e não deve emprestar socket, credenciais ou fila
  ao GitHub Actions runner.
- Registrar **um único runner dedicado** a este repositório, com rótulo
  `data-library-docker`, em ambiente Docker isolado dos serviços de produção.
  Preferir host/VM de CI independente. Na VPS compartilhada, homologar somente
  com um daemon **rootless exclusivo** e limites de recursos, sem conectar
  containers aos volumes ou redes do Painel, PostgreSQL ou outros projetos.
- **Não** montar `/var/run/docker.sock`, utilizar o grupo `docker`,
  `--privileged`, sockets TCP abertos ou compartilhar a API Docker administrativa.
  Um runner que controla um daemon Docker pode controlar os containers desse
  daemon; mesmo rootless não deve ser considerado sandbox completa contra código
  não confiável.
- Não fornecer ao runner credenciais persistentes de administração do GitHub,
  tokens pessoais, HMAC ou acesso SSH da VPS. O token de registro, caso necessário,
  deve ser fornecido por canal restrito e não deve entrar no repositório, logs ou
  arquivo `.env` versionado.
- Se um job precisar baixar dependências externas, manter rede de saída somente
  para esse fim; nenhuma porta de serviço precisa ser publicada no host.

## Limites e acionamento

O workflow executa apenas em push da `main` ou por
`workflow_dispatch` explícito. Não executa `pull_request`, push para
`feat/**`, `fix/**` nem código de fork automaticamente no runner da VPS.

Os containers individuais limitam o consumo, **não** o daemon Docker, o runner
ou o total de jobs paralelos. Para uma VPS de uso compartilhado, iniciar com
apenas um runner e medir RAM, disco, CPU, swap e limpeza de imagens.
Queda de Docker, download de imagens e o custo de instalação dos pacotes
continuam possíveis mesmo com esses limites. Não conectar a `main` nem
habilitar deploy automático como resultado destes testes.

## Checklist de homologação (apenas leitura)

1. Em GitHub → Settings → Actions → Runners, confirmar que existe um runner
   `Online` dedicado ao Data Library com os quatro rótulos exatos.
2. No ambiente isolado do runner, verificar a API Docker selecionada e confirmar
   `SecurityOptions` com `name=rootless`; confirmar usuário e propriedade do
   socket. **Nunca** testar contra a API Docker rootful da VPS de produção.
3. Confirmar que o runner está em container ou host dedicado, não executa como
   root, não herda volumes/redes administrativos e que só há um executor ativo.
4. Validar a disponibilidade de espaço para imagens e assegurar que a execução
   não pode consumir a memória reservada aos outros projetos.
5. Executar o workflow **manualmente** em commit aprovado e inspecionar os nove
   jobs, incluindo Angular, Go `-race`, Rust e C++ com sanitizers.
6. Somente após os nove jobs passarem no runner identificado, considerar o
   CI self-hosted homologado; `queued`, `skipped` ou `cancelled` não são sucesso.

## Verificação da política no checkout

```sh
python3 -m unittest discover -s tests -p 'test_ci_docker_runner.py' -v
```

A checagem é estática: não instala runner, não inicia containers, não cria
usuários, não acessa a VPS e não concede permissões ao Docker.
