# Escrita atômica em arquivo

Substitui arquivo de texto com os.replace sem deixar arquivo temporário após erros.

**Linguagem:** python · **Categoria:** io · **ID:** `python.io.atomic-write`

## Executar

```bash
python python/io/atomic-write/solution.py
```

## Validar

```bash
python python/io/atomic-write/test_solution.py
```

Limite: atomicidade da substituição no mesmo sistema de arquivos; fsync do arquivo não garante persistência do diretório em todos os sistemas.
