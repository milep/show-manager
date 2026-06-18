#!/usr/bin/env bash
set -euo pipefail

HOST=$(grep '^SHOW_MANAGER_HOST=' /home/devops/config/dev/show-manager.env | cut -d= -f2)
PORT=$(grep '^SHOW_MANAGER_PORT=' /home/devops/config/dev/show-manager.env | cut -d= -f2)

sudo systemctl status show-manager --no-pager
curl -fsS "http://${HOST}:${PORT}/status"
echo
curl -fsS "http://${HOST}:${PORT}/api/status"
echo
