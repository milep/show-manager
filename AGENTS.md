# AGENTS.md

## Purpose
- Personal hobby project for controlling the `raspberrypi` display show.
- React + Vite frontend.
- Node.js + TypeScript + Express backend.
- Host-run development and deployment on one server.
- Production runtime uses `systemd`.

## Repo-root sessions
- Treat `/home/devops/workspace/projects/show-manager` as the repo root.
- Prefer repo-relative commands and file references.
- Keep work inside this repo unless a task explicitly spans the Raspberry Pi host or host service setup.

## Coding Style (For Agents)
- This is an app, not a reusable library.
- Optimize for clear local behavior.
- Do not add library-style extension points.
- Do not add plugin systems.
- Do not add configuration matrices.
- Do not preserve old internal APIs.
- Update callers directly.
- Keep one obvious path.
- Start concrete.
- Extract only after real duplication.
- Prefer plain functions.
- Use classes only when existing service shape fits.
- Keep modules small.
- Keep dependencies minimal.
- Use shadcn/ui for reusable UI primitives.
- Avoid framework churn.
- Avoid generic abstractions.
- Avoid speculative helpers.
- Use TypeScript strictness.
- Avoid `any`.
- Use zod schemas at HTTP and shared-data boundaries.
- Comments explain non-obvious reasons.
- Comments should not restate code.

## Architecture Notes
- `web/` contains the Vite React UI.
- `components.json` configures shadcn/ui.
- `server/` contains the Express app.
- `shared/` contains shared zod schemas and types.
- `test/` contains backend-focused Vitest tests.
- `server/src/routes/` owns HTTP route wiring.
- `server/src/services/` owns filesystem, media, auth, bundle, and Raspberry Pi operations.
- Keep browser fetch code in `web/src/lib/api.ts`.
- Keep shared payload shape in `shared/show-schema.ts`.
- Prefer direct route-to-service flow.
- Avoid separate domain layers unless duplication demands them.

## Local Runtime & Commands
- Install dependencies:
  - `npm install`
- Run tests:
  - `npm run test`
- Run type checks:
  - `npm run check`
- Build everything:
  - `npm run build`
- Run backend in development:
  - `npm run dev:server`
- Run frontend in development:
  - `npm run dev:web`
- Start built server:
  - `npm run start`

## Agent Automation
- After code changes, run:
  - `npm run test`
  - `npm run check`
  - `npm run build`
- Use narrower commands only for quick iteration.
- Finish with full validation when practical.
- Include a manual validation step when tests cannot cover runtime behavior.

## Testing
- Prefer focused Vitest tests.
- Use temporary data roots in tests.
- Avoid network calls in unit tests.
- Mock Raspberry Pi `ssh` and `scp` behavior.
- Test route behavior with Supertest.
- Test shared schema changes with route or service coverage.
- Do not add browser E2E tooling without explicit need.

## Environment & Configuration
- This runs on one host machine.
- Keep configuration small.
- Use ENV only for host, port, data root, Raspberry Pi SSH target, and public base URL.
- Keep fixed local values as code constants.
- Do not add toggles for fixed behavior.
- Do not add dev/prod behavior matrices.
- Default host config lives at:
  - `/home/devops/config/dev/show-manager.env`
- Example config lives at:
  - `config-examples/show-manager.env.example`
- Data root defaults to:
  - `/home/devops/data/dev/show-manager`
- Uploads live under:
  - `/home/devops/data/dev/show-manager/uploads`
- State lives under:
  - `/home/devops/data/dev/show-manager/state`
- Runtime files live under:
  - `/home/devops/data/dev/show-manager/runtime`
- Keep generated data out of git.

## Deployment Runtime
- Single host process runs under `systemd`.
- Service name:
  - `show-manager`
- Service unit:
  - `deploy/systemd/show-manager.service`
- Runtime entrypoint:
  - `node dist/server/src/main.js`
- Install or update service:
  - `./scripts/install-systemd-dev.sh`
- Restart service:
  - `./scripts/show-manager-restart.sh`
- Check service:
  - `./scripts/show-manager-status.sh`
- Status endpoints:
  - `GET /status`
  - `GET /api/status`

## Raspberry Pi Display Target
- Remote SSH target defaults to:
  - `rasp`
- Remote root is fixed:
  - `/home/pi/show-player`
- Active release path:
  - `/home/pi/show-player/active`
- Apply pushes only playlist media.
- Apply restarts `mpv` through `run-show.sh`.
- Keep remote-release handling simple.
- Default retention keeps 3 releases.

## Media Notes
- Supported images:
  - `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- Supported videos:
  - `.mp4`, `.mov`, `.mkv`, `.webm`
- Host requires `ffmpeg`.
- Host requires `ffprobe`.
- Raspberry Pi requires `mpv`.
- Remote apply requires `ssh` and `scp`.

## Access Notes
- Tailnet access is trusted.
- Public access uses QR-session auth.
- Caddy handles public and tailnet routing.
- App should bind to localhost in public setup.
- Keep auth behavior direct and understandable.

## Notes
- `node_modules` is not committed.
- `dist/` is generated.
- Lockfile is committed.
- Keep startup deterministic.
- Avoid hidden migrations.
- Avoid implicit boot side effects.
- Prefer repairable JSON state files.
- Treat this as a useful household machine, not a platform product.
- Complex systems invite Cthulhu.
- This repo should not.
