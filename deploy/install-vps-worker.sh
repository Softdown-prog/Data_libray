#!/usr/bin/env bash
# Instala Data Library sem modificar Node, npm, Docker ou serviços globais.
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Execute: sudo bash deploy/install-vps-worker.sh" >&2
  exit 2
fi

base="/var/lib/data-library-worker"
repo="$base/repo"
origin="https://github.com/Softdown-prog/Data_libray.git"
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
node_version="v24.22.2"
node_dir="$base/tools/node"
node_bin="$node_dir/bin"

# Pré-requisitos básicos para instalar Node de maneira privada.
missing=""
for tool in git python3 curl tar xz sha256sum runuser systemctl getent useradd install uname awk; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing="$missing $tool"
  fi
done
if [[ -n "$missing" ]]; then
  echo "Ferramentas de instalação ausentes:$missing" >&2
  exit 1
fi

if id data-library >/dev/null 2>&1; then
  if [[ "$(getent passwd data-library | cut -d: -f6)" != "$base" ]]; then
    echo "Usuário data-library existe com HOME inesperado: abortando." >&2
    exit 1
  fi
else
  useradd --system --user-group --home-dir "$base" --shell /usr/sbin/nologin data-library
fi

install -d -m 0750 -o data-library -g data-library "$base" "$base/state" "$base/tools"

if [[ ! -x "$node_bin/node" ]]; then
  if [[ -e "$node_dir" ]]; then
    echo "Instalação privada Node incompleta em $node_dir; investigar sem sobrescrever." >&2
    exit 1
  fi
  case "$(uname -m)" in
    x86_64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Arquitetura Node não suportada: $(uname -m)" >&2; exit 1 ;;
  esac
  archive="node-$node_version-linux-$arch.tar.xz"
  address="https://nodejs.org/dist/$node_version"
  temporary="$(mktemp -d)"
  trap 'rm -rf "$temporary"' EXIT
  echo "Instalando Node.js $node_version localmente, sem apt global."
  curl --fail --silent --show-error --location --retry 3 \
    "$address/$archive" -o "$temporary/$archive"
  curl --fail --silent --show-error --location --retry 3 \
    "$address/SHASUMS256.txt" -o "$temporary/SHASUMS256.txt"
  awk -v file="$archive" '$2 == file {print; n++} END {if (n != 1) exit 1}' \
    "$temporary/SHASUMS256.txt" > "$temporary/checksums"
  (cd "$temporary" && sha256sum --check checksums)
  install -d -m 0750 -o data-library -g data-library "$node_dir"
  tar -xJf "$temporary/$archive" -C "$node_dir" --strip-components=1
  chown -R data-library:data-library "$node_dir"
fi

if [[ "$("$node_bin/node" --version)" != "$node_version" ]]; then
  echo "Node privado tem versão diferente de $node_version: abortando." >&2
  exit 1
fi
if [[ ! -x "$node_bin/npm" ]]; then
  echo "npm ausente na instalação privada do Node: abortando." >&2
  exit 1
fi
echo "Node privado: $("$node_bin/node" --version)"
export PATH="$node_bin:$PATH"

# O pacote Ubuntu golang-1.24-go instala o binário em /usr/lib/go-1.24/bin;
# não mexer nos symlinks globais do host ou nos outros projetos.
if ! command -v go >/dev/null 2>&1 && [[ -x /usr/lib/go-1.24/bin/go ]]; then
  export PATH="/usr/lib/go-1.24/bin:$PATH"
fi

# Reporte TODOS os outros compiladores ausentes, em vez de falhar um por vez.
missing=""
for tool in go g++ cargo javac; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing="$missing $tool"
  fi
done
if [[ -n "$missing" ]]; then
  echo "Node instalado; compiladores ausentes:$missing" >&2
  echo "No Ubuntu 24.04: apt-get update && apt-get install -y --no-install-recommends g++ rustc cargo openjdk-21-jdk-headless golang-1.24-go" >&2
  echo "Não ativei nenhum serviço; instale as dependências e execute novamente." >&2
  exit 1
fi

if [[ "$(go version)" != *"go1.2"[3-9]* && "$(go version)" != *"go1.3"* ]]; then
  echo "Go detectado é anterior a 1.23; instale golang-1.24-go e use seu PATH versionado." >&2
  exit 1
fi
if ! javac -version 2>&1 | grep -Eq '^javac 21([. ]|$)'; then
  echo "Java 21 é necessário; verifique update-alternatives e openjdk-21-jdk-headless." >&2
  exit 1
fi

if [[ ! -d "$repo/.git" ]]; then
  if [[ -e "$repo" ]]; then
    echo "Destino $repo já existe sem Git. Abortando." >&2
    exit 1
  fi
  runuser -u data-library -- git clone --depth 1 --branch main "$origin" "$repo"
fi
installed_origin="$(git -C "$repo" remote get-url origin)"
if [[ "$installed_origin" != "$origin" && "$installed_origin" != "https://github.com/Softdown-prog/Data_libray" ]]; then
  echo "Remote inesperado: não alterar outros projetos." >&2
  exit 1
fi

runuser -u data-library -- env "HOME=$base" "PATH=$PATH" \
  npm install --prefix "$base/tools" --no-save --ignore-scripts \
  --no-audit --no-fund 'typescript@~6.0.0'
runuser -u data-library -- env "HOME=$base" "PATH=$PATH" \
  npm install --prefix "$repo/angular" --ignore-scripts --no-audit --no-fund
runuser -u data-library -- env "HOME=$base" "PATH=$PATH" \
  python3 "$repo/scripts/catalog.py" --check

install -m 0644 -o root -g root \
  "$source_dir/deploy/systemd/data-library-worker.service" \
  /etc/systemd/system/data-library-worker.service
systemctl daemon-reload
systemctl enable --now data-library-worker.service
systemctl --no-pager --full status data-library-worker.service || true
echo "Logs: journalctl -u data-library-worker -n 80 --no-pager"
