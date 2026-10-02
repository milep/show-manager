# Show Manager

A self-hosted display-show and party-playlist controller.

Show Manager runs on a home server.
It manages a Raspberry Pi display player.
It also controls YouTube playback on Android TV.

The project is built for one trusted household deployment.
It is not a general SaaS platform.
It favors direct behavior over plugins.

## Use cases

### Always-on display show

A Raspberry Pi connects to an always-on display.
The display can loop uploaded images and videos.
The server keeps the media library and playlist editable from a browser.
Apply pushes the active bundle to the Pi.
The Pi plays the bundle with `mpv`.

### YouTube party playlist

The party playlist lets guests add music and videos from their phones.
Guests open the public playlist UI through a QR code.
They do not need Wi-Fi access.
They do not need a shared YouTube account.

Playback uses the native YouTube app on Android TV.
The TV is logged into a YouTube Premium account.
This keeps playback inside the ad-free account session.
The server controls the TV through ADB.

Native YouTube playlists are not a good fit here.
They are awkward to update live during a party.
The transient party queue is easier to search, edit, skip, clear, and replace in real time.

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
- Remove or move Upcoming entries one position up/down in `/playlist-manager`.
- Pause, play, and skip from mobile UI.
- Clear party queue from trusted UI.
- Radio mode shuffles all confirmed videos into the queue.
- Pippalot replaces the queue from its randomized SQLite playlist.
- Pause persists across service restarts.

Upcoming edits save immediately to the party queue; there is no separate Save or Apply.
Duplicate entries can be removed independently. Now Playing stays protected.
Move swaps adjacent Upcoming entries; the first cannot move up and the last cannot move down.
These edits never change source media, saved playlists, Pippalot order, or cached files.

Prerequisite:

```bash
ssh rasp 'adb devices -l'
```

The TV should appear as `192.168.1.104:5555 device`.

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

Start Pippalot:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/pippalot
```

Pippalot uses the fixed `pippalot` playlist stored in SQLite.
Each click shuffles the cached items.
Each click replaces the transient party queue.
Runtime playback never fetches the source playlist.
The initial cache comes from the source playlist once.
Source-playlist synchronization remains manual.

Save one YouTube link without changing the active queue:

```bash
curl -s -X POST http://127.0.0.1:4791/api/youtube/playlists/pippalot/items \
  -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/GF3wagWwHjM"}'
```

The trusted root page exposes the same action near the top.
Links normalize by YouTube video ID.
Duplicate Pippalot items stay unchanged.

Append newly added source items manually:

```bash
sudo node scripts/pippalot-import-new.mjs
```

The script follows every playlist page.
The script adds only missing video IDs.
Existing cached items remain unchanged.
Manual cache additions remain unchanged.
Source deletions remain cached.
The script creates a SQLite backup before writes.
Run the script again after completion.
A successful second run reports `added: 0`.
No service restart is required.
Never schedule this command.

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
The API fallback follows every `nextPageToken`.
This retrieves playlists exceeding the 50-item page limit.
The importer is append-only.
Existing video IDs are skipped.
Confirmed videos appear first in search.
Use the backfill script to add thumbnails and channel metadata.

## HASACOOL presenter for the YouTube queue

The backend owns a persistent SSH input reader on the Pi.
It uses `SHOW_MANAGER_RASP_SSH_TARGET` and the existing SSH identity.
It does not expose another HTTP endpoint or bypass QR-session auth.

Five-button mapping (single presses verified live on the TCL TV on 2026-10-01):

| Physical button | Captured Linux keydown | Queue action |
| --- | --- | --- |
| Play | Left Shift `42` then F5 `63` | Explicit resume. Never toggle. |
| Stop | B `48` | Explicit pause. Keep the current track. |
| Right | PageDown `109` | Existing skip: resume intent, mark current skipped, check the queue. |
| Chain | Plain Tab `15`, no modifiers | Check power, wake if asleep or screensaver-dreaming, wait for native YouTube readiness, shuffle/replace/start cached Pippalot. |
| Windows | Left Alt `56` then Tab `15` | Pause and persist automation pause, then explicit TV sleep and verify asleep. Keep queue/current. |

Alt+Tab never dispatches Chain. Captured Alt release about 1.45 seconds after Tab-up does not dispatch anything.

Only the receiver named `Smart 2.4G Receiver`, USB vendor `3151`, product `3021`, serial `b120300001` is read.
Both keyboard and consumer interfaces are discovered through sysfs.
Event numbers are not fixed.
Other devices and unmapped keys are ignored.
Releases and held-key repeats do not dispatch actions.
A fixed 300 ms per-action debounce suppresses the captured duplicate Play chords 93 ms apart.
Very fast repeated presses inside that window are intentionally ignored.
Admission is bounded to 16 ordinary in-flight actions plus one independent Off slot.
Even at saturation, a strictly validated, fresh Windows frame reaches immediate preparation cancellation.
Repeated Windows frames coalesce while that Off is pending; malformed/stale frames never consume its slot.
A validated, fresh, debounce-eligible coalesced Windows press still cancels any newer Chain preparation immediately,
without adding another serialized pause/sleep body. Disconnect/stop invalidates that cancellation admission too.

Prerequisites:

- Python 3 on the Pi. No extra Python packages.
- The configured SSH user can read the receiver event nodes. The confirmed `pi` user already belongs to `input`.
- Existing host-to-Pi SSH and Pi-to-TV ADB access.
- Host and Pi clocks are synchronized within two seconds. Old input events and stale stream frames are discarded.

Activation is automatic when the backend main process starts with this version.
The first SSH reader connection waits 12 seconds after presenter start.
Presenter buttons are unavailable during this lease-safety window.
App construction in tests does not start the reader.
No reader file, Pi service, permission change, or privileged listener is installed.
The host sends the standard-library Python source as the SSH command.
Received lines are strict, versioned JSON actions. They are never shell commands.

The reader scans for USB changes every second.
It drains startup input backlog and clears key state on reattach.
SSH disconnects cancel queued presenter actions and active TV preparation/readiness.
Reconnect waits 12 seconds after the old SSH process closes.
Every presenter start also waits 12 seconds, including a replacement backend instance.
The existing systemd three-second restart delay is not relied on for reader ownership.
The reader exits on stdin EOF or after ten seconds without a host heartbeat.
Local SSH close does not prove that EOF reached the Pi.
Both waits allow an old reader's lease to expire even when EOF is lost.
Stop closes stdin, cancels any initial/reconnect wait, and waits for SSH exit, with local signal fallbacks.
Connecting or reattaching never sends play, pause, or skip.
The existing queue scheduler still runs normally and honors persisted pause.
Presenter, browser controls, ticks, and active-queue edits share scheduler ordering.
Pause persists only after ADB succeeds. Play resumes intent before ADB.
Skip with no pending item does not stop the TV.
Browser clear, radio, and Pippalot keep their existing behavior.
The existing authenticated `/api/tv/power-toggle` still sends a raw toggle and returns `{ ok: true }`;
it now cancels pending/active Chain preparation and shares scheduler ordering.
Chain and Windows never send a power toggle or schedule future actions.

### TV ordering, deadlines and failure handling

Every shell ADB command uses `-s SHOW_MANAGER_ADB_TV_TARGET`; no receiver input becomes a command.
The configured target is retained, not replaced by a discovered address or a new default.
Wake/off decisions accept only stable, unambiguous `dumpsys power` Awake/Asleep/Dreaming states; Dreaming is the observed screensaver.
Dozing is recognized only as transient. A known state with `mWakefulnessChanging=true` is also transient, never evidence of Awake/Asleep or permission to toggle.
Initial decisions wait cancellably for a stable state; a standalone stable-power query before Off has a 10-second deadline and at most 20 polls.
Unknown/unreachable/ambiguous output still fails closed without wake/toggle or queue replacement; unknown states are not treated as transitions.
When present, the changing flag must be valid/unambiguous and false for a stable result (older dumps may omit it).
Already Awake is left on. Asleep or Dreaming receives explicit `KEYCODE_WAKEUP` once; Dreaming must then become exact Awake.
Powered/unchanging flags or screensaver window presence never substitute for Awake or native YouTube readiness.
Readiness requires reported Awake, `sys.boot_completed=1`, native YouTube launch within `com.google.android.youtube.tv`,
and both focused window and resumed activity in that package (not HDMI, ping or a stale media session).
Focus is queried with `dumpsys window displays`; TCL's `dumpsys window windows` omits `mCurrentFocus`.
The separate `dumpsys activity activities` check must still report native YouTube resumed/top-resumed.
Preparation has one fixed 30-second deadline and 500 ms polling; initial stable-state and readiness phases each cap at 60 polls under that shared deadline.
Dozing during readiness continues polling but cannot satisfy Awake. Initial waiting does not reset or extend the deadline.
Only after readiness does the scheduler call the same cached Pippalot shuffle/replace/tick body as the UI, exactly once.
There is no playlist/cache synchronization. Missing/empty cache, failed/cancelled preparation preserves old queue and persisted pause.
Once replacement commits, existing launch-retry behavior remains: failed video launch leaves pending items for later ticks
and records `lastError`; it does not roll back the replacement.

Windows cancels pending/active Chain preparation immediately before its own serialized action.
For Awake or Dreaming: explicit media pause must succeed, then pause is persisted, then `KEYCODE_SLEEP` is sent and exact Asleep verified.
Pause failure prevents sleep; sleep/verification failure retains successful persisted pause and reports failure.
For already Asleep: record automation pause without waking or sending media pause; sleep verification is idempotent.
Unknown/offline never claims off. Queue/current are never cleared; no automatic resume is introduced.
Sleep initial-state waiting and verification share one 10-second deadline, 500 ms polling, and at most 20 polls per phase.
After sleep, Dozing/changing output continues polling until stable exact Asleep; transient timeout after successful pause retains persisted pause.
Frame freshness is checked at operation entry (two seconds), not during a legitimate longer wake operation.
Windows enters at supersession request admission; its accepted frame cannot expire while waiting for cancelled preparation to drain.
Disconnect and scheduler stop abort pending/active TV operations; ordinary accepted controls still drain in order.

ADB commands run inside a Pi Python standard-library watchdog: five seconds then kill/wait for the child.
Once started, the watchdog ignores SSH hangup until its child exits and bounds that child's lifetime.
Local SSH has a 12-second timeout; cancellation/timeout sends TERM then KILL after 250 ms and awaits child close.
Every runner rejection (including timeout or transport loss with an unaborted signal) holds ordering for an additional 11 seconds:
five seconds late-start allowance matching the SSH connect budget, five seconds watchdog runtime, one second teardown margin.
Off/toggle cannot bypass that guard. The guard is conservative quarantine, not fabricated proof of remote exit;
unexpectedly delayed/suspended remote startup remains a live transport validation gap.
Preparation/readiness cancellation during a command therefore drains in approximately 11.25 seconds;
30s preparation or 10s sleep deadlines may include that teardown margin. A local SSH timeout plus guard can take 23.25 seconds.
No new packages or config switches are required.

Shutdown stops new ticks and aborts pending/active TV preparation, but preserves ordinary accepted tick/browser FIFO draining.
This is not a global shutdown deadline: multiple commands/backlogged browser operations can exceed the existing systemd `TimeoutStopSec=20`
(even one ambiguous local SSH timeout plus its guard can exceed it). Systemd may then terminate the host before graceful draining completes.
The service setting and ordinary-control product policy are unchanged; supervisor should assess this in the authorized shutdown check.

Playback status accepts numeric Android states and matching symbolic forms such as `PLAYING(3)`, `PAUSED(2)` and `STOPPED(1)`.
Malformed/mismatched tokens remain unknown; numeric state mapping and queue advancement/startup-grace policies are unchanged.

### Supervisor live validation (not performed by repository tests)

Live single-press checks passed on 2026-10-01 after authorized activation.
The target is the integrated TCL Smart TV Pro at the configured `192.168.68.104:5555`.
The corrected controller woke the TV from Asleep and verified native YouTube readiness in 7,304 ms.
The existing Pippalot API loaded 257 cached items and playback reported Playing.
Physical Windows paused automation, kept the queue/current track, and reached stable Asleep. The user confirmed panel-off.
Physical Chain then woke the TV, opened native YouTube, and replaced the queue with 257 freshly shuffled items. The user confirmed playback.
Physical Stop paused the same track; Play resumed it; Right advanced exactly one pending track.
The service stayed active/enabled. Public queue access without a QR session returned HTTP 401.
Exactly one Pi presenter reader remained after the service restarts.
Repository validation passed 201 tests, type checks, and builds before activation.
Local evidence and rollback files are retained under `/home/devops/audit/show-presenter-20261001`.

Earlier live checks exposed the TCL display-focus query, Dreaming screensaver state, Dozing sleep transition,
and symbolic media state format. The code and fixtures now handle these outputs.
Live interruption, held-key, screensaver-exit, failure, and slideshow interaction checks remain incomplete.
Use an authorized maintenance window and a synthetic queue for the remaining checks.

Check held buttons, duplicate Play chords, and the captured Alt+Tab release sequence.
Check Chain from Awake, screensaver Dreaming and true standby, actual panel wake/screensaver exit, boot duration, and native YouTube focus (never external HDMI).
Check Windows from Awake/Dreaming/Asleep, actual panel-off, persisted pause/current queue, pause and sleep failures, and unreachable/unknown state.
Check Windows and browser power-toggle during slow Chain preparation, including saturated input and local timeout/transport loss,
with no Pippalot commit or late wake after off. Verify late remote startup fits the conservative guard.
Check native-app absence/unready behavior, cached-list absence, post-commit video failure/retry, and bounded shutdown/remote watchdog teardown.
If actual standby does not support ADB wake, escalate; do not infer/install CEC, IR or vendor APIs.
Check concurrent browser skip/pause, persisted pause after restart, USB removal/reattach, and SSH loss/recovery.
Check backend replacement with lost remote EOF. Allow the initial 12-second reader wait.
Confirm no extra skip or resume, no overlapping readers, and normal queue order.
Check ADB failure recovery and backend shutdown.

The reader does not grab input devices or change slideshow/mpv configuration.
The same key events may still reach the existing slideshow or global mpv controls.
Check that interaction on the real Pi before acceptance.
Repository tests use synthetic sysfs, event, SSH-process, and ADB fixtures only.
They do not prove live hardware, permissions, clocks, transport teardown, or slideshow behavior.
Repository validation does not deploy or restart any service; supervisor owns authorized live operations.

## Development

```bash
npm install
npm run test
npm run check
npm run build
npm run dev:server
npm run dev:web
```

## VPS service install

```bash
./scripts/install-systemd-dev.sh
./scripts/show-manager-status.sh
./scripts/show-manager-restart.sh
```

Service binds to localhost in the public setup.

## Raspberry Pi player install

The Pi requires `mpv`, `openvt`, SSH, and passwordless sudo for user `pi`.
Tailscale provides the existing VPS-to-Pi SSH path.

Install the slideshow service from the VPS:

```bash
./scripts/install-rasp-player.sh rasp
```

Apply a fresh show after the first service installation.
The fresh bundle uses native `systemd` lifecycle control.
The service starts the active `mpv` slideshow once during boot.
The installer masks `getty@tty1.service` for exclusive display ownership.
Local TTY1 login remains unavailable while that unit stays masked.
SSH access remains unchanged.
The service does not restart `mpv` after a crash.
Applying a show starts or restarts slideshow playback.
YouTube playback and ADB connections never start automatically.

Inspect the Pi service:

```bash
ssh rasp 'systemctl is-enabled show-player.service'
ssh rasp 'systemctl status show-player.service --no-pager'
```

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
- `YOUTUBE_DATA_API_KEY` optional secret for YouTube Data API video search and paginated playlist fetching.

### YouTube Data API key

Store the key outside the repository:

```text
/home/devops/secrets/dev/show-manager.secrets.env
```

Use dotenv syntax:

```env
YOUTUBE_DATA_API_KEY=your_api_key_here
```

The `show-manager` systemd unit loads this file automatically.
Restart the service after changing the key:

```bash
./scripts/show-manager-restart.sh
```

The playlist scraper and backfill scripts first inspect their process environment.
They next inspect the secrets file.
They finally inspect the main development env file.
Root-protected secret directories may block direct script access.
Export the variable explicitly or run the script with suitable permissions in that case.
Never commit the real key.

The API key supports these features:

- YouTube video search.
- Complete playlist fetching through `playlistItems.list` pagination.
- Confirmed-video metadata backfilling.
- Playlist scraper fallback when `yt-dlp` returns incomplete results.

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
Public routes must send `x-show-manager-access: public`.
Trusted routes should omit that header.
Do not expose the backend directly to the public internet.
A missing public header means trusted access.
