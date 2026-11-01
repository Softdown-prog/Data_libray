# Nome de arquivo restrito

**ID:** `python.security.safe-filename` · **Linguagem:** Python · **Categoria:** security · **Estado:** documented

## Objetivo e comportamento

Valida estritamente um único nome de arquivo ASCII de 1 a 64 caracteres e bloqueia separadores de caminho, nomes de dispositivo reservados no Windows e pontos finais ambíguos.

## Quando usar

Use para nomear arquivos simples de exportação, relatórios e anexos gerados por aplicações quando aceitar somente ASCII e a política de nomes for consistente entre Linux e Windows.

## Quando não usar

Não use para validar caminhos completos, autorizar acesso a diretórios, proteger uploads sozinho, evitar ataques por symlink ou aceitar nomes de arquivos internacionais/Unicode.

## Pré-requisitos

- Python 3.12+ e biblioteca padrão re; sem dependências externas.
- Nome precisa ser uma string ASCII com primeiro caractere alfanumérico, até 64 caracteres de comprimento.
- Ao abrir arquivos reais, a aplicação ainda deve impor diretório-base, autorização, tratamento de symlinks e operações seguras de I/O.

## Entradas

- name: str — um nome de arquivo isolado, sem separadores, com letras A-Z/a-z, dígitos e caracteres . _ - após o primeiro caractere.
- Um objeto pathlib.Path, bytes, int ou None não é aceito e deve ser convertido deliberadamente no chamador somente se isso for apropriado.

## Saídas

- Retorna a própria string de entrada se ela estiver de acordo com a política.
- Não cria diretórios, não resolve paths e não executa I/O; o resultado pode ser usado como componente de nome após a autorização no diretório.

## Exemplo de utilização

Execute de dentro do diretório `python/security/safe-filename` para usar a importação mostrada:

```python
from solution import validate_filename

safe = validate_filename("relatorio-2026.json")  # retorna o próprio nome
try:
    validate_filename("CON.txt")
except ValueError:
    print("Nome reservado não permitido")
```

## Executar ou integrar

No diretório raiz do repositório:

```bash
python python/security/safe-filename/solution.py
```

Saída esperada: `relatorio-2026.json`. A execução é local e não acessa arquivos do usuário.

## Testar

No diretório raiz do repositório:

```bash
python python/security/safe-filename/test_solution.py
python scripts/run_python_tests.py
```

## Tratamento de erros

- TypeError se name não for str: erro de contrato de chamada e não uma falha de sistema de arquivos.
- ValueError se o texto contiver separadores, caractere proibido, tamanho fora de 1–64, pontos isolados, ponto final ou nomes reservados de dispositivos no Windows.
- Não captura OSError, pois esta função não abre nem grava arquivos; I/O deve ser tratado na camada responsável pelo filesystem.

## Limitações e riscos

- Validação de basename não impede ataques por symlink ou race condition TOCTOU ao abrir um arquivo posteriormente.
- Não implementa autorização, isolamento do diretório, política de permissões, verificação de existência ou tratamento de sobrescrita.
- Nomes Unicode, caracteres acentuados, espaços e arquivos ocultos iniciados por ponto são proibidos por decisão de produto.
- A lista de dispositivos reservados cobre CON, PRN, AUX, NUL, COM1–COM9 e LPT1–LPT9, inclusive com extensões; não é um substituto completo para todas as regras específicas de cada filesystem.

## Diagnóstico e correção

### Caso 1

**Sintoma:** Um nome aparentemente comum, como CON.txt, gera ValueError em uma execução no Linux.

**Causa provável:** O validador aplica uma política de portabilidade para evitar nomes de dispositivos especiais reservados no Windows.

**Correção:** Renomeie o arquivo de maneira inequívoca, como console.txt, ou escolha uma política não portátil em outro validador com testes próprios.

### Caso 2

**Sintoma:** O método valida report.txt mas o programa ainda consegue abrir um arquivo fora do diretório esperado.

**Causa provável:** Um nome válido não autoriza o acesso nem protege a abertura de arquivos em diretórios contendo symlinks.

**Correção:** Imponha isolamento por diretório e autorização, use operações de abertura seguras contra symlinks e evite verificar path e abrir em etapas sujeitas a corrida.

### Caso 3

**Sintoma:** Um nome com acentos, como relatório.txt, é rejeitado pelo padrão.

**Causa provável:** A expressão regular aceita intencionalmente somente ASCII para simplificar portabilidade e comparações.

**Correção:** Se precisar de Unicode, defina uma política própria de normalização, colisão, tamanho e caracteres reservados, em vez de ignorar a validação existente.

## Verificação automatizada

**Nível:** automated-tests

**Escopo:** Ruff lint, compileall e unittest na GitHub Actions para nomes válidos, comprimento máximo, caminhos, caracteres especiais, tipos inválidos e dispositivos Windows.

**Lacunas:** Não há teste de filesystem real em Windows nem validação de resistência a symlink/TOCTOU; não se trata de sandbox ou barreira de autorização.

## Arquivos catalogados

- `solution.py` — implementação e documentação embutida
- `test_solution.py` — testes de casos válidos, falhas e limites
- `example.json` — contrato estruturado v2
- `README.md` — manual técnico e resolução de problemas

## Origem e manutenção

Exemplo original da Data Library revisado para política de nomes de arquivo portáveis. Qualquer alteração na política requer atualização simultânea do código, dos testes, do README e do catálogo, preservando o ID. `documented` não é garantia de segurança de armazenamento.
