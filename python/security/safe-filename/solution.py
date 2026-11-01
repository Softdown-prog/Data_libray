import re

VALID_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z")


def validate_filename(name: str) -> str:
    """Aceita nomes portáveis e nega caminhos, pontos isolados e separadores."""
    if name in {".", ".."} or not VALID_NAME.fullmatch(name):
        raise ValueError("nome de arquivo inválido")
    return name
