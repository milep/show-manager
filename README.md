# Show Manager

A self-hosted display-show and party-playlist controller.

Show Manager runs on a home server.
It manages a Raspberry Pi display player.
It also controls YouTube playback on Android TV.

The project is built for one trusted household deployment.
It is not a general SaaS platform.
It favors direct behavior over plugins.

## Features

- Browser UI for managing display playlists.
- Uploads for images and videos.
- Thumbnail and metadata extraction with `ffmpeg` and `ffprobe`.
- Draft editing with explicit apply.
- Raspberry Pi deployment over `ssh` and `scp`.
- `mpv` playback on the Raspberry Pi.
- Public QR login for guests.
- Public mobile party playlist UI.
- YouTube and YouTube Music search.
- Android TV YouTube control through ADB.
- SQLite-backed transient party queue.
- Trusted-admin saved playlists.
- Trusted-admin radio mode from confirmed music videos.
- Confirmed music-video imports from playlists and channels.
- Optional YouTube Data API support for better video search.
- `yt-dlp` import helpers for quota-light scraping.

## Architecture

- React + Vite frontend.
- shadcn/ui components.
- Node.js + TypeScript backend.
- Express HTTP server.
- Shared Zod schemas.
- SQLite state for YouTube data.
- `systemd` production runtime.

## Hardware model

- One host server runs the web app.
- One Raspberry Pi runs the display player.
- One Android TV runs the YouTube app.
- The host reaches the Pi through SSH.
- The Pi reaches Android TV through ADB.

## Repo layout

- `web/` frontend app
- `server/` backend app
- `shared/` zod schemas shared across backend and frontend
- `test/` backend-focused tests
- `deploy/systemd/` service unit
- `scripts/` install and ops helpers
- `config-examples/` example env file

## Runtime paths

Default development paths:

- Config: `/home/devops/config/dev/show-manager.env`
- Optional secrets: `/home/devops/secrets/dev/show-manager.secrets.env`
- Data root: `/home/devops/data/dev/show-manager`
- Uploads: `/home/devops/data/dev/show-manager/uploads`
- State: `/home/devops/data/dev/show-manager/state`
- Runtime: `/home/devops/data/dev/show-manager/runtime`
- Remote root: `/home/pi/show-player`

These paths are local deployment defaults.
Change them before using another host layout.

## Supported media

- Images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- Videos: `.mp4`, `.mov`, `.mkv`, `.webm`

## Display show workflow

Edits save into one local draft.

Apply builds one active bundle.

Apply pushes only playlist media to the Raspberry Pi.

Apply updates `/home/pi/show-player/active`.

Apply restarts `mpv` through `run-show.sh`.

Library deletion stays out of scope for now.

## YouTube TV party playlist

The backend controls native YouTube on Android TV through ADB.

YouTube media, saved playlists, confirmed videos, and the party queue live in SQLite under the app state directory.
Saved playlists are trusted-admin only.
Confirmed-video imports are trusted-admin only.
QR sessions can search and edit only the transient party queue.

Party features:

- Search YouTube songs and videos.
- Add videos to the queue end.
- Add one item next.
- Multi-select results.
- Pause, play, and skip from mobile UI.
- Clear party queue from trusted UI.
- Radio mode shuffles all confirmed videos into the queue.
- Pause persists across service restarts.

Prerequisite:

```bash
ssh rasp 'adb devices -l'
```

The TV should appear as `192.168.68.104:5555 device`.

Search YouTube Music:

```bash
curl -s 'http://127.0.0.1:4791/api/youtube/search?q=massive%20attack%20teardrop'
```

Search returns `song` and `video` results.
QR sessions may use search.

Inspect party queue and playback:

```bash
curl -s http://127.0.0.1:4791/api/youtube-queue
```

Append a video URL to the party queue:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/items \
  -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/GF3wagWwHjM"}'
```

Append a search result to the party queue:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/items \
  -H 'content-type: application/json' \
  -d '{"videoId":"Tb0MC0jFv6M","kind":"song","title":"Teardrop","artists":["Massive Attack"],"album":"Mezzanine"}'
```

Add a video next:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/items/next \
  -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/GF3wagWwHjM"}'
```

Skip current item:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/skip
```

Shuffle pending items:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/shuffle-rest
```

Trigger playback check:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/play
```

Clear party queue:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/clear
```

Start confirmed-video radio:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/radio
```

List trusted saved playlists:

```bash
curl -s http://127.0.0.1:4791/api/youtube/playlists
```

Import confirmed music videos:

```bash
node scripts/youtube-scrape-confirmed.mjs 'https://www.youtube.com/playlist?list=PLM3I17KSuAh-sbQ5yfuDT9MUIEZWpFnFK' --out /tmp/confirmed-videos.jsonl
node scripts/youtube-scrape-confirmed.mjs 'https://www.youtube.com/@NuclearBlastRecords/videos' --out /tmp/confirmed-videos.jsonl
node scripts/youtube-import-confirmed.mjs /tmp/confirmed-videos.jsonl
sudo env PATH=/home/devops/.local/bin:/usr/local/bin:/usr/bin:/bin node scripts/youtube-backfill-confirmed.mjs
```

The scraper uses `yt-dlp` first.
For playlists where `yt-dlp` only returns part of the playlist, the scraper falls back to YouTube Data API when `YOUTUBE_DATA_API_KEY` is available.
The importer is append-only.
Existing video IDs are skipped.
Confirmed videos appear first in search.
Use the backfill script to add thumbnails and channel metadata.

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

A reverse proxy can serve trusted tailnet access without login.

A public route can use QR-session auth.

## Key env vars

See `config-examples/show-manager.env.example`.

Important vars:

- `SHOW_MANAGER_HOST`
- `SHOW_MANAGER_PORT`
- `SHOW_MANAGER_DATA_ROOT`
- `SHOW_MANAGER_RASP_SSH_TARGET`
- `SHOW_MANAGER_PUBLIC_BASE_URL`
- `YOUTUBE_DATA_API_KEY` optional secret for YouTube Data API video search and playlist import fallback.

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

## Access model

Tailnet access is trusted.

Public access requires QR login.

QR sessions last 24 hours.

A reverse proxy such as Caddy can expose separate tailnet and public routes.
Public routes should send `x-show-manager-access: public`.
Trusted routes should omit that header.
