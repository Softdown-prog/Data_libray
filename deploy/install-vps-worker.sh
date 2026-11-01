#!/usr/bin/env bash
# Instala somente o serviço Data Library; nenhum GitHub runner ou Docker.
set -euo pipefail
if [[ "$EUID" -ne 0 ]]; then
  echo "Execute como root: sudo bash deploy/install-vps-worker.sh" >&2
  exit 2
fi
base="/var/lib/data-library-worker"
repo="$base/repo"
origin="https://github.com/Softdown-prog/Data_libray.git"
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
for tool in git python3 node npm go g++ cargo javac runuser systemctl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Toolchain ausente: $tool; instale antes de iniciar." >&2
    exit 1
  fi
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)' || {
  echo "Node.js >= 24 é necessário" >&2
  exit 1
}
if id data-library >/dev/null 2>&1; then
  if [[ "$(getent passwd data-library | cut -d: -f6)" != "$base" ]]; then
    echo "Usuário data-library usa HOME inesperado; abortando." >&2
    exit 1
  fi
else
  useradd --system --user-group --home-dir "$base" --shell /usr/sbin/nologin data-library
fi
install -d -m 0750 -o data-library -g data-library "$base" "$base/state" "$base/tools"
if [[ ! -d "$repo/.git" ]]; then
  if [[ -e "$repo" ]]; then
    echo "O destino existe sem checkout Git; abortando." >&2
    exit 1
  fi
  runuser -u data-library -- git clone --depth 1 --branch main "$origin" "$repo"
fi
installed_origin="$(git -C "$repo" remote get-url origin)"
if [[ "$installed_origin" != "$origin" && "$installed_origin" != "https://github.com/Softdown-prog/Data_libray" ]]; then
  echo "Remote inesperado. Abortando para proteger outros projetos." >&2
  exit 1
fi
runuser -u data-library -- env HOME="$base" npm install --prefix "$base/tools" \
  --no-save --ignore-scripts --no-audit --no-fund 'typescript@~6.0.0'
runuser -u data-library -- env HOME="$base" npm install --prefix "$repo/angular" \
  --ignore-scripts --no-audit --no-fund
runuser -u data-library -- env HOME="$base" python3 "$repo/scripts/catalog.py" --check
install -m 0644 -o root -g root \
  "$source_dir/deploy/systemd/data-library-worker.service" \
  /etc/systemd/system/data-library-worker.service
systemctl daemon-reload
systemctl enable --now data-library-worker.service
systemctl --no-pager --full status data-library-worker.service || true
echo "Veja os logs: journalctl -u data-library-worker -n 80 --no-pager"
