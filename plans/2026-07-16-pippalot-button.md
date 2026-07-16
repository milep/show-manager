# Pippalot Button Implementation Plan

**Goal:** Add a trusted Pippalot button that replaces the party queue with a randomized SQLite-cached playlist.

**Scope:**
- Use fixed playlist ID `pippalot`.
- Read only SQLite data.
- Randomize every button click.
- Replace the queue atomically.
- Seed current YouTube items once.
- Document manual SQLite ownership.

**Out of scope:**
- Runtime YouTube fetching.
- Automatic cache synchronization.
- Cache editing APIs.
- Cache editing UI.
- Separate design documentation.

**Key constraints:**
- Preserve existing Radio behavior.
- Keep Pippalot data separate.
- Restrict actions to trusted users.
- Preserve queues on missing caches.
- Use current playlist tables.

**Delivery strategy:** Two sprints separate backend behavior from UI rollout.

**Plan status:**
- Sprint 1: `completed`
- Sprint 2: `completed`

## Sprint 1: Cached queue replacement

**Sprint outcome:** The trusted endpoint randomizes cached Pippalot items.

**Validation goal:** Route tests prove replacement, access control, and missing-cache safety.

**Read these files first:**
- `server/src/services/youtube-store.ts`
- `server/src/routes/youtube-queue.ts`
- `test/youtube-queue-route.test.ts`

### Task 1.1: Add store behavior

**Why:** Queue replacement belongs inside one SQLite transaction.

**Files:**
- Modify: `server/src/services/youtube-store.ts`

**Implementation steps:**
1. Add fixed ID `pippalot`.
2. Read cached playlist items.
3. Reject missing caches.
4. Reject empty caches.
5. Apply Fisher–Yates shuffling.
6. Replace queue transactionally.
7. Return queued count.

**Validation:**
- Run: `npx vitest run test/youtube-queue-route.test.ts`
- Expect: Existing route tests pass.

### Task 1.2: Add trusted endpoint

**Why:** The UI needs one direct action.

**Files:**
- Modify: `server/src/routes/youtube-queue.ts`
- Modify: `test/youtube-queue-route.test.ts`

**Implementation steps:**
1. Add `POST /api/youtube-queue/pippalot`.
2. Require trusted access.
3. Resume queue automation.
4. Replace from cache.
5. Trigger scheduler playback.
6. Return queued count.
7. Test randomized replacement.
8. Test public rejection.
9. Test missing-cache preservation.

**Validation:**
- Run: `npx vitest run test/youtube-queue-route.test.ts`
- Expect: New boundary tests pass.

**Sprint completion check:**
- Run: `npm run check:server`
- Expect: Strict server checks pass.

**Plan update after sprint:**
- Completed cached queue replacement.
- Added trusted endpoint coverage.
- Confirmed atomic missing-cache safety.
- Preserved existing Radio behavior.
- Kept Sprint 2 unchanged.

**Sprint review answers:**
- Replacement stays transactional.
- Radio remains unchanged.
- Missing caches preserve queues.

## Sprint 2: UI and initial seed

**Sprint outcome:** Trusted users can start Pippalot from the main UI.

**Validation goal:** Builds pass and production SQLite contains all current playlist items.

**Read these files first:**
- `web/src/components/show-manager-app.tsx`
- `web/src/lib/api.ts`
- `README.md`
- `deploy/systemd/show-manager.service`

### Task 2.1: Add client action

**Why:** The trusted UI needs a clear control.

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/show-manager-app.tsx`

**Implementation steps:**
1. Add `startPippalot()`.
2. Add separate busy state.
3. Add `Pippalot` beside Radio.
4. Display queued counts.
5. Display endpoint errors.

**Validation:**
- Run: `npm run check:web`
- Expect: Strict web checks pass.

### Task 2.2: Document cached ownership

**Why:** Future updates remain manual.

**Files:**
- Modify: `README.md`

**Implementation steps:**
1. Document fixed SQLite cache.
2. Document randomized loading.
3. State runtime fetch exclusion.
4. State manual update policy.

**Validation:**
- Run: `git diff --check`
- Expect: Documentation diff passes.

### Task 2.3: Seed current playlist

**Why:** The deployed button needs initial data.

**Files:**
- Modify runtime data: `/home/devops/data/dev/show-manager/state/youtube.sqlite`

**Implementation steps:**
1. Read the configured API key.
2. Fetch all playlist pages.
3. Validate 243 current items.
4. Upsert YouTube media rows.
5. Replace `pippalot` playlist rows.
6. Use one SQLite transaction.
7. Verify stored item count.
8. Avoid repository sync tooling.

**Validation:**
- Query the `pippalot` item count.
- Expect: Count equals fetched valid items.

**Sprint completion check:**
- Run: `npm run test`
- Run: `npm run check`
- Run: `npm run build`
- Expect: All commands pass.

**Plan update after sprint:**
- Completed the trusted UI action.
- Documented SQLite-only runtime behavior.
- Seeded 243 cached items.
- Backed up SQLite first.
- Passed 69 tests.
- Passed all type checks.
- Passed production builds.
- Restarted the service successfully.

**Sprint review answers:**
- Route tests confirm reshuffling.
- Route tests confirm replacement.
- Scheduler invocation remains immediate.

## Final validation

- Run: `npm run test`
- Run: `npm run check`
- Run: `npm run build`
- Query Pippalot cache count.
- Verify randomized orders through route tests.
- Expect full validation success.

## Risks / sequencing notes

- Deploy code before button use.
- Seed SQLite before testing.
- Deleted YouTube items may fail playback.
- Manual SQLite updates need transactions.
- Cthulhu dislikes partial writes.
