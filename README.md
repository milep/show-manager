# Show Manager

Show controller for the `raspberrypi` display.

## Stack

- React + Vite frontend
- shadcn/ui components
- Node + TypeScript backend
- Express HTTP server
- `ffmpeg` and `ffprobe` for thumbnails and metadata
- `ssh` and `scp` for remote apply
- `mpv` on `raspberrypi`

## Repo layout

- `web/` frontend app
- `server/` backend app
- `shared/` zod schemas shared across backend and frontend
- `test/` backend-focused tests
- `deploy/systemd/` service unit
- `scripts/` install and ops helpers
- `config-examples/` example env file

## Runtime paths

- Config: `/home/devops/config/dev/show-manager.env`
- Data root: `/home/devops/data/dev/show-manager`
- Uploads: `/home/devops/data/dev/show-manager/uploads`
- State: `/home/devops/data/dev/show-manager/state`
- Runtime: `/home/devops/data/dev/show-manager/runtime`
- Remote root: `/home/pi/show-player`

## Supported media

- Images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- Videos: `.mp4`, `.mov`, `.mkv`, `.webm`

## Draft and apply

Edits save into one local draft.

Apply builds one active bundle.

Apply pushes only playlist media to `rasp`.

Apply updates `/home/pi/show-player/active`.

Apply restarts `mpv` through `run-show.sh`.

Library deletion stays out of scope for v1.

## Development

```bash
npm install
npm run test
npm run check
npm run build
npm run dev:server
npm run dev:web
```

## Service install

```bash
./scripts/install-systemd-dev.sh
./scripts/show-manager-status.sh
./scripts/show-manager-restart.sh
```

Service binds to localhost in the public setup.

Caddy serves tailnet access without login.

Caddy serves `show.miikaleppanen.com` with QR-session auth.

## Key env vars

See `config-examples/show-manager.env.example`.

Important vars:

- `SHOW_MANAGER_HOST`
- `SHOW_MANAGER_PORT`
- `SHOW_MANAGER_DATA_ROOT`
- `SHOW_MANAGER_RASP_SSH_TARGET`
- `SHOW_MANAGER_PUBLIC_BASE_URL`

Fixed local values stay in code:

- Max upload size: `250000000` bytes
- Remote root: `/home/pi/show-player`
- Remote releases kept: `3`
- Public access header: `x-show-manager-access: public`
- Session cookie: `show_manager_session`

## Remote layout

- `/home/pi/show-player/releases/<apply-id>`
- `/home/pi/show-player/active`
- `/home/pi/show-player/player.pid`
- `/home/pi/show-player/player.log`

Old remote releases prune automatically after apply.

Default retention keeps 3 releases.

## Tailscale access

Default tailnet URL: `http://100.65.130.34:4791`.

Tailnet access is trusted.

Public URL: `https://show.miikaleppanen.com`.

Public access requires QR login.

QR sessions last 24 hours.
