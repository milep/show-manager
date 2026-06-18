#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/devops/workspace/projects/show-manager"
UNIT_SRC="${REPO_DIR}/deploy/systemd/show-manager.service"
UNIT_DST="/etc/systemd/system/show-manager.service"
DEV_ENV="/home/devops/config/dev/show-manager.env"

if [[ ! -f "${DEV_ENV}" ]]; then
  echo "Missing ${DEV_ENV}. Create it from config-examples/show-manager.env.example"
  exit 1
fi

cd "${REPO_DIR}"
npm install
npm run build
sudo cp "${UNIT_SRC}" "${UNIT_DST}"
sudo systemctl daemon-reload
sudo systemctl enable --now show-manager
sudo systemctl restart show-manager
sudo systemctl status show-manager --no-pager
curl -fsS "http://$(grep '^SHOW_MANAGER_HOST=' "${DEV_ENV}" | cut -d= -f2):$(grep '^SHOW_MANAGER_PORT=' "${DEV_ENV}" | cut -d= -f2)/status"
