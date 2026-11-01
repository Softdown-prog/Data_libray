# SAC-008E — pré-homologação offline para VPS multiprojetos

Esta etapa **não executa Docker, SSH, GitHub Actions operacionais nem acessa a VPS**.
O validador `scripts/sac_vps_readiness.py` verifica somente uma **declaração de plano de instalação**
e a unidade systemd de referência da Data Library. Uma saída `plan-review-pass` significa
*contrato do plano consistente*, não que a VPS esteja preparada.

## Separação obrigatória de serviços

- `data-library-worker.service` continua exclusivo do catálogo local, sob `data-library`, sem
  acesso ao socket do Docker, sem grupo `docker`, sem flags `--sac-build/--sac-audit/--sac-inbox`
  e mantendo `NoNewPrivileges`, `PrivateDevices`, `ProtectSystem=strict` e `IPAddressDeny=any`.
- Para processar Angular de outros repositórios, será necessário um usuário **diferente**,
  por exemplo `sac-builder`, e um serviço **separado**, isolado da Data Library, com container
  runtime rootless e socket exclusivo do UID do builder; não compartilhar o Docker rootful
  nem o socket de infraestrutura global do Painel.
- O operador deve comprovar o estado real por inspeção read-only da VPS antes de qualquer ativação,
  incluindo grupos, proprietário do socket, origem do checkout, rootless mode, locks,
  permissões de artefatos, segregação do `HMAC`, limpeza e quotas de disco.
- Limites de plano para a VPS multiprojetos: **1 build por vez, 1 vCPU, 1024 MiB RAM,
  128 processos, 120 s**, com reserva de memória para os demais serviços. Esses valores
  não garantem que um Angular grande caiba; o CI hospedado pode assumir builds maiores.

## Uso offline

```sh
python3 scripts/sac_vps_readiness.py --plan /caminho/confiavel/plan.json \
  --catalog-unit deploy/systemd/data-library-worker.service
```

O arquivo do plano é declarado pelo operador (nunca fornecido por Issue nem por repositório
que está sendo compilado). O verificador não executa comando livre, não instala pacotes e não
escreve em local algum. A checagem rejeita campos desconhecidos e retorna JSON com códigos
de bloqueio. Testes sintéticos são executados pelo GitHub Actions.

**Importante:** mesmo um plano aprovado declara `runtime_verified=false` e
`deployment_authorized=false`. Não autoriza merge, instalação nem publicação.
Na futura homologação real, revisar o serviço rootless dedicado e usar um
mecanismo de delegação restrita; a CLI `docker` do SAC-008D não deve ganhar
acesso ao socket Docker rootful da VPS.

Não disponibilizar `sudo`, grupo `docker`, porta TCP do daemon, credenciais,
segredos do GitHub ou Docker socket ao Worker da Data Library.
