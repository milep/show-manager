#!/usr/bin/env bash
set -euo pipefail

sudo systemctl restart show-manager
sudo systemctl status show-manager --no-pager
