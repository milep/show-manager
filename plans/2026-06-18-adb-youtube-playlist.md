# ADB YouTube Playlist Implementation Plan

**Goal:** Add backend-first ADB control for a YouTube queue on the TV.

**Scope:**
- Persist a YouTube playback queue in local JSON state.
- Expose REST endpoints for queue inspection and control.
- Poll native YouTube playback through ADB on `rasp`.
- Start queued videos through Android TV intents.
- Advance to the next queued video without UI dependency.
- Keep existing display-show apply flow unchanged.

**Out of scope:**
- Full playlist-manager UI replacement.
- Drag-and-drop rearranging.
- YouTube Data API metadata lookup.
- Multi-TV support.
- Chromecast or PyChromecast control.
- Public queue permissions redesign.

**Key constraints:**
- App runs as one Node + TypeScript process under `systemd`.
- Raspberry Pi SSH target defaults to `rasp`.
- ADB runs on `rasp`.
- TV target is fixed for MVP at `192.168.68.104:5555`.
- Store generated state under the configured data root.
- Use zod at HTTP and shared-data boundaries.
- Tests must mock SSH and ADB behavior.
- Keep one obvious code path.

**Delivery strategy:**
- Split into 3 sprints.
- Sprint 1 creates schemas, persistence, and route contracts.
- Sprint 2 adds ADB parsing and playback commands.
- Sprint 3 adds the scheduler and runtime smoke checks.

**Plan status:**
- Sprint 1: `completed`
- Sprint 2: `completed`
- Sprint 3: `completed`

**Implementation notes:**
- Added shared queue, playback, scheduler schemas.
- Added `state/youtube-queue.json` persistence.
- Added `/api/youtube-queue` REST endpoints.
- Added ADB control through `ssh rasp adb ...`.
- Added native YouTube `dumpsys media_session` parsing.
- Added backend scheduler with a 5-second interval.
- Added a 15-second startup grace for newly launched videos.
- Added README curl examples.
- Runtime smoke confirmed ADB status polling from a temporary built server.

## Context reviewed

- `README.md`
- `AGENTS.md`
- `shared/show-schema.ts`
- `server/src/app.ts`
- `server/src/routes/status.ts`
- `server/src/services/show-state-store.ts`
- `server/src/services/rasp-controller.ts`
- `web/src/App.tsx`
- `web/src/components/playlist-manager-mock.tsx`
- `web/src/lib/api.ts`
- `test/*` listing

## Proposed API

### `GET /api/youtube-queue`

Returns:

```json
{
  "queue": {
    "items": [],
    "currentItemId": null,
    "updatedAt": "2026-06-18T00:00:00.000Z"
  },
  "playback": {
    "connected": true,
    "state": "playing",
    "packageName": "com.google.android.youtube.tv",
    "videoId": "GF3wagWwHjM",
    "title": "The Chosen Legacy",
    "subtitle": "Dimmu Borgir",
    "positionMs": 433,
    "durationMs": null,
    "checkedAt": "2026-06-18T00:00:00.000Z",
    "detail": null
  },
  "scheduler": {
    "enabled": true,
    "lastTickAt": "2026-06-18T00:00:00.000Z",
    "lastError": null
  }
}
```

### `POST /api/youtube-queue/items`

Request:

```json
{ "url": "https://youtu.be/GF3wagWwHjM?si=L3g__FquhQPkR7G4" }
```

Behavior:
- Extract `GF3wagWwHjM`.
- Append item to queue.
- Return full queue snapshot.

### `POST /api/youtube-queue/skip`

Behavior:
- Mark current queue item complete.
- Start next item on next scheduler tick.
- Return full queue snapshot.

### `POST /api/youtube-queue/play`

Behavior:
- Trigger immediate scheduler tick.
- Start current or first queued item.
- Return full queue snapshot.

## Sprint 1: Queue schema, persistence, and HTTP API

**Sprint outcome:**
- Backend persists queue JSON.
- REST API supports read, append, skip, and manual play trigger.
- ADB behavior remains stubbed.

**Smoke check / validation goal:**
- Supertest can append links and observe persisted queue state.

**Read these files first:**
- `shared/show-schema.ts`
- `server/src/services/show-state-store.ts`
- `server/src/app.ts`
- `test/test-helpers.ts`
- `test/show-route.test.ts`

### Task 1.1: Add shared YouTube queue schemas

**Why:** Define typed API and persisted queue boundaries.

**Files:**
- Modify: `shared/show-schema.ts`

**Implementation steps:**
1. Add `youtubeQueueItemSchema`.
2. Include `id`, `videoId`, `url`, `title`, `subtitle`, `addedAt`, `startedAt`, and `completedAt`.
3. Add `youtubeQueueStateSchema`.
4. Include `items`, `currentItemId`, and `updatedAt`.
5. Add `youtubePlaybackStatusSchema`.
6. Include `connected`, `state`, `packageName`, `videoId`, `title`, `subtitle`, `positionMs`, `durationMs`, `checkedAt`, and `detail`.
7. Add `youtubeQueueSnapshotSchema`.
8. Export inferred types.

**Validation:**
- Run: `npm run check`
- Expect: TypeScript accepts new exports.

### Task 1.2: Add data-root path for queue state

**Why:** Persist queue under existing data root conventions.

**Files:**
- Modify: `server/src/services/data-root.ts`
- Verify: `test/*data-root*` if present

**Implementation steps:**
1. Add `youtubeQueueFile` to `DataRootPaths`.
2. Point it under `state/youtube-queue.json`.
3. Ensure existing directory creation covers the file parent.

**Validation:**
- Run: `npm run test -- data-root`
- Expect: Relevant tests pass or no matching tests run.

### Task 1.3: Add queue persistence methods

**Why:** Keep JSON state handling in the existing store.

**Files:**
- Modify: `server/src/services/show-state-store.ts`
- Modify: `test/show-state-store.test.ts`

**Implementation steps:**
1. Add an empty queue fallback.
2. Add `getYoutubeQueue()`.
3. Add `saveYoutubeQueue(queue)`.
4. Parse using zod schema.
5. Write pretty JSON.
6. Add tests for missing file fallback.
7. Add tests for round-trip persistence.

**Validation:**
- Run: `npm run test -- show-state-store`
- Expect: Store tests pass.

### Task 1.4: Add YouTube link parser

**Why:** Accept common pasted YouTube URLs without external calls.

**Files:**
- Create: `server/src/services/youtube-link.ts`
- Create: `test/youtube-link.test.ts`

**Implementation steps:**
1. Parse `youtu.be/<id>`.
2. Parse `youtube.com/watch?v=<id>`.
3. Parse `youtube.com/shorts/<id>` only if simple.
4. Reject invalid IDs.
5. Use 11-character YouTube id format.
6. Return `{ videoId, canonicalUrl }`.

**Validation:**
- Run: `npm run test -- youtube-link`
- Expect: Parser tests pass.

### Task 1.5: Add queue route with stub playback service

**Why:** Expose commandline-friendly REST controls early.

**Files:**
- Create: `server/src/routes/youtube-queue.ts`
- Modify: `server/src/app.ts`
- Create: `test/youtube-queue-route.test.ts`

**Implementation steps:**
1. Create `createYoutubeQueueRouter(services)`.
2. Add `GET /api/youtube-queue`.
3. Add `POST /api/youtube-queue/items`.
4. Add `POST /api/youtube-queue/skip`.
5. Add `POST /api/youtube-queue/play` as a no-op trigger for now.
6. Return a snapshot with playback state `unknown`.
7. Wire route in `createApp`.
8. Add Supertest coverage for append, invalid URL, skip, and snapshot.

**Validation:**
- Run: `npm run test -- youtube-queue-route`
- Expect: Route tests pass.

**Sprint completion check:**
- Run: `npm run test -- youtube`
- Run: `npm run check`
- Expect: Tests and typecheck pass.

**Plan update after sprint:**
- Update `Plan status` for Sprint 1.
- Add implementation notes under this sprint.
- Record schema or route changes.
- Revise later sprint tasks if route shape changes.

**Sprint review questions:**
- Does the REST shape support commandline operation?
- Does persistence survive process restart?
- Did any existing show state code need cleanup?
- Should skip semantics change before adding ADB?

## Sprint 2: ADB status parsing and playback commands

**Sprint outcome:**
- Backend can ask `rasp` for native YouTube playback status.
- Backend can start a video by video id via ADB.
- Tests prove command construction and parser behavior.

**Smoke check / validation goal:**
- A mocked `ssh rasp adb ...` runner returns parsed YouTube metadata.

**Read these files first:**
- `server/src/services/rasp-controller.ts`
- `server/src/services/run-command.ts`
- `server/src/config.ts`
- `test/rasp-controller.test.ts`
- `test/test-helpers.ts`

### Task 2.1: Add fixed ADB constants

**Why:** Keep MVP config small and explicit.

**Files:**
- Modify: `server/src/config.ts`

**Implementation steps:**
1. Add `ADB_TV_TARGET = "192.168.68.104:5555"`.
2. Add `YOUTUBE_TV_PACKAGE = "com.google.android.youtube.tv"`.
3. Avoid new ENV variables for MVP.

**Validation:**
- Run: `npm run check`
- Expect: TypeScript passes.

### Task 2.2: Add ADB command service

**Why:** Isolate remote command construction from queue policy.

**Files:**
- Create: `server/src/services/adb-youtube-controller.ts`
- Create: `test/adb-youtube-controller.test.ts`

**Implementation steps:**
1. Accept `ShowManagerConfig` and `CommandRunner`.
2. Run ADB through SSH to `config.raspSshTarget`.
3. Implement `connect()` with `adb connect 192.168.68.104:5555`.
4. Implement `getPlaybackStatus()` with `adb shell dumpsys media_session`.
5. Implement `playVideo(videoId)` with `adb shell am start -a android.intent.action.VIEW -d https://www.youtube.com/watch?v=<id>`.
6. Implement `pause()` and `skipKey()` only if needed for tests or API.
7. Return structured playback status.

**Validation:**
- Run: `npm run test -- adb-youtube-controller`
- Expect: Command construction tests pass.

### Task 2.3: Parse `dumpsys media_session`

**Why:** Scheduler needs reliable native YouTube state.

**Files:**
- Modify: `server/src/services/adb-youtube-controller.ts`
- Modify: `test/adb-youtube-controller.test.ts`

**Implementation steps:**
1. Locate block containing `package=com.google.android.youtube.tv`.
2. Parse `PlaybackState {state=N, position=M, ... speed=S}`.
3. Map `state=3` to `playing`.
4. Map `state=2` to `paused`.
5. Map terminal states to `ended` when applicable.
6. Map absent package to `idle`.
7. Parse `metadata: ... description=<title>, <subtitle>, ...`.
8. Return raw detail on parse uncertainty.
9. Include `checkedAt` in service result.

**Validation:**
- Run: `npm run test -- adb-youtube-controller`
- Expect: Parser covers playing, paused, idle, stale Cast session, and unauthorized error.

### Task 2.4: Wire ADB status into queue snapshot

**Why:** REST clients need real TV state.

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/routes/youtube-queue.ts`
- Modify: `test/youtube-queue-route.test.ts`

**Implementation steps:**
1. Add `adbYoutubeController` to `AppServices`.
2. Instantiate it in `createAppServices`.
3. Use it in `GET /api/youtube-queue`.
4. Keep route resilient when ADB fails.
5. Return `connected=false` and `detail` on ADB failure.
6. Update route tests with a fake controller.

**Validation:**
- Run: `npm run test -- youtube-queue-route adb-youtube-controller`
- Expect: Snapshot returns queue plus ADB status.

**Sprint completion check:**
- Run: `npm run test -- youtube adb-youtube-controller`
- Run: `npm run check`
- Expect: Tests and typecheck pass.

**Runtime smoke check:**
- Run after build or dev server: `curl http://127.0.0.1:4791/api/youtube-queue`
- Expect: JSON includes native YouTube playback status from TV.

**Plan update after sprint:**
- Update `Plan status` for Sprint 2.
- Add parser examples actually observed.
- Record any TV-specific dumpsys differences.
- Revise scheduler state rules if needed.

**Sprint review questions:**
- Does parser ignore stale `mediashell` Cast sessions?
- Does ADB reconnection work after service restart?
- Does metadata include enough title data for MVP?
- Are state mappings sufficient for auto-advance?

## Sprint 3: Scheduler and queue advancement

**Sprint outcome:**
- Backend advances the queue without browser polling.
- New items can be added through REST and started automatically.
- Manual play and skip endpoints trigger immediate work.

**Smoke check / validation goal:**
- Unit tests simulate status transitions and observe queue advancement plus play commands.

**Read these files first:**
- `server/src/app.ts`
- `server/src/main.ts`
- `server/src/routes/youtube-queue.ts`
- `server/src/services/adb-youtube-controller.ts`
- `server/src/services/show-state-store.ts`
- `test/youtube-queue-route.test.ts`

### Task 3.1: Add scheduler service

**Why:** Playback should continue without UI visits.

**Files:**
- Create: `server/src/services/youtube-queue-scheduler.ts`
- Create: `test/youtube-queue-scheduler.test.ts`

**Implementation steps:**
1. Accept store and ADB controller.
2. Track in-memory `lastTickAt`, `lastError`, and `running` guard.
3. Implement `tick()`.
4. Load queue.
5. Load playback status.
6. If no current item and queue has items, set first item current and start it.
7. If playback is idle or ended for current item, mark current completed and start next item.
8. If playback is playing or paused, update current item title/subtitle from metadata.
9. Avoid overlapping ticks.
10. Save queue only when changed.

**Validation:**
- Run: `npm run test -- youtube-queue-scheduler`
- Expect: Scheduler tests pass.

### Task 3.2: Start scheduler with app services

**Why:** Make scheduler part of backend runtime.

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/main.ts`
- Modify: `test/smoke.test.ts`

**Implementation steps:**
1. Add `youtubeQueueScheduler` to services.
2. Start interval from runtime bootstrap, not route construction.
3. Use a fixed 5-second interval.
4. Call `tick()` once at startup.
5. Stop interval on process shutdown if existing lifecycle supports it.
6. Keep tests from starting real intervals by default.

**Validation:**
- Run: `npm run test -- smoke youtube-queue-scheduler`
- Expect: No hanging tests.

### Task 3.3: Make REST controls trigger scheduler

**Why:** Commandline clients should see prompt behavior.

**Files:**
- Modify: `server/src/routes/youtube-queue.ts`
- Modify: `test/youtube-queue-route.test.ts`

**Implementation steps:**
1. After append, call `tick()`.
2. For manual play, call `tick()`.
3. For skip, mark current complete and call `tick()`.
4. Return updated snapshot.
5. Include scheduler status in response.

**Validation:**
- Run: `npm run test -- youtube-queue-route youtube-queue-scheduler`
- Expect: Route tests prove tick calls and updated snapshots.

### Task 3.4: Add commandline smoke examples

**Why:** Initial control path is REST and shell, not UI.

**Files:**
- Modify: `README.md`

**Implementation steps:**
1. Add backend YouTube queue section.
2. Document `GET /api/youtube-queue`.
3. Document append curl command.
4. Document skip curl command.
5. Document ADB prerequisite: authorized TV at `192.168.68.104:5555` from `rasp`.

**Validation:**
- Run: `grep -n "youtube-queue" README.md`
- Expect: Commands are documented.

**Sprint completion check:**
- Run: `npm run test -- youtube`
- Run: `npm run check`
- Run: `npm run build`
- Expect: Tests, typecheck, and build pass.

**Runtime smoke check:**
1. Restart or run backend.
2. Run: `curl -s http://127.0.0.1:4791/api/youtube-queue`
3. Run: `curl -s -X POST http://127.0.0.1:4791/api/youtube-queue/items -H 'content-type: application/json' -d '{"url":"https://youtu.be/GF3wagWwHjM"}'`
4. Run on `rasp`: `adb shell dumpsys media_session | grep -E "package=com.google.android.youtube.tv|state=|metadata:" -A2 -B1 | head -40`
5. Expect: TV starts queued video and route shows matching current item.

**Plan update after sprint:**
- Update `Plan status` for Sprint 3.
- Record runtime smoke check results.
- Record any service restart or ADB authorization issues.
- Mark plan complete or add follow-up tasks.

**Sprint review questions:**
- Does scheduler start videos without browser access?
- Does skip behave predictably?
- Does paused playback block auto-advance correctly?
- Does ADB failure preserve queue safely?

## Final validation

- Run: `npm run test`
- Run: `npm run check`
- Run: `npm run build`
- Runtime smoke: append a YouTube URL through REST.
- Runtime smoke: confirm TV starts playback through ADB.
- Runtime smoke: confirm `GET /api/youtube-queue` reports native YouTube metadata.

## Risks / sequencing notes

- ADB authorization can expire or reset on the TV.
- `dumpsys media_session` output may differ by TV firmware.
- YouTube app may keep stale sessions after Cast playback.
- The scheduler must ignore `com.google.android.apps.mediashell`.
- Fixed TV IP is acceptable for MVP.
- A future UI can consume the REST snapshot directly.
- Queue rearranging can be added after backend behavior proves stable.
