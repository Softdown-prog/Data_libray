"""Data Library ID: python.security.safe-filename

Propósito: validar um único nome de arquivo ASCII, nunca um caminho completo.
Quando usar: nomes de arquivos de exportação controlados por uma aplicação.
Quando evitar: como única proteção de acesso a arquivos ou contra symlinks.
Falhas: TypeError para tipo incorreto, ValueError para nome fora da política.
Correções: consulte README.md e example.json deste diretório.
"""

import re

# Política intencionalmente restrita: ASCII, 1 a 64 caracteres, sem separadores.
# A validação é independente do sistema operacional, inclusive quando roda em Linux.
_VALID_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")
_WINDOWS_DEVICE_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{number}" for number in range(1, 10)}
    | {f"LPT{number}" for number in range(1, 10)}
)


def validate_filename(name: str) -> str:
    """Retorna o nome aprovado; rejeita nomes ambíguos/portavelmente inseguros.

    Não resolve caminhos, não abre arquivos e não garante autorização, ausência
    de symlinks nem inexistência de condições de corrida no sistema de arquivos.
    """
    if not isinstance(name, str):
        raise TypeError("nome de arquivo deve ser uma string")
    if name in {".", ".."} or _VALID_NAME.fullmatch(name) is None:
        raise ValueError("nome de arquivo fora da política ASCII (1–64 caracteres)")
    if name.endswith("."):
        raise ValueError("nome de arquivo não pode terminar em ponto")
    if name.split(".", maxsplit=1)[0].upper() in _WINDOWS_DEVICE_NAMES:
        raise ValueError("nome de arquivo reservado pelo Windows")
    return name


if __name__ == "__main__":
    print(validate_filename("relatorio-2026.json"))
