#!/usr/bin/env bash
set -euo pipefail

TARGET=${1:-rasp}
UNIT_NAME=show-player.service
UNIT_SOURCE=$(cd "$(dirname "$0")/.." && pwd)/deploy/systemd/$UNIT_NAME
REMOTE_TMP=/tmp/$UNIT_NAME

scp "$UNIT_SOURCE" "$TARGET:$REMOTE_TMP"
ssh "$TARGET" "sudo install -o root -g root -m 0644 '$REMOTE_TMP' '/etc/systemd/system/$UNIT_NAME' && rm -f '$REMOTE_TMP' && sudo systemctl daemon-reload && { systemctl is-enabled getty@tty1.service 2>/dev/null | grep -qx masked || sudo systemctl mask --now getty@tty1.service; } && sudo systemctl daemon-reload && sudo systemctl enable '$UNIT_NAME'"

if ssh "$TARGET" "grep -q 'show-player.service' /home/pi/show-player/active/run-show.sh 2>/dev/null"; then
  ssh "$TARGET" "sudo systemctl restart '$UNIT_NAME'"
  echo "$UNIT_NAME installed, enabled, and started on $TARGET"
else
  echo "$UNIT_NAME installed and enabled on $TARGET"
  echo "Apply a fresh show bundle before starting the service"
fi
