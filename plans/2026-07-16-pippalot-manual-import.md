# Pippalot Manual Import Plan

**Goal:** Add a manual script that appends newly published source-playlist items into the cached Pippalot SQLite playlist.

**Scope:**
- Fetch every source page.
- Add missing video IDs.
- Preserve cached items.
- Preserve manual additions.
- Back up SQLite first.
- Document agent execution.
- Import current additions now.

**Out of scope:**
- Automatic synchronization.
- Item removals.
- Existing item updates.
- Runtime application fetching.
- Editing APIs or UI.

**Key constraints:**
- Use fixed local paths.
- Use one SQLite transaction.
- Keep the script manual.
- Never print API secrets.

**Delivery strategy:** One sprint covers the small operational workflow.

**Plan status:**
- Sprint 1: `completed`

## Sprint 1: Repeatable manual import

**Sprint outcome:** Agents can safely append new Pippalot items on request.

**Validation goal:** A real import reports additions and preserves the existing 243 items.

**Read these files first:**
- `scripts/youtube-backfill-confirmed.mjs`
- `server/src/services/youtube-store.ts`
- `AGENTS.md`
- `README.md`

### Task 1.1: Add importer

**Why:** Repeated ad-hoc SQL creates operational risk.

**Files:**
- Create: `scripts/pippalot-import-new.mjs`

**Implementation steps:**
1. Use the fixed source playlist.
2. Follow every `nextPageToken`.
3. Read existing playlist video IDs.
4. calculate missing items.
5. Exit cleanly when current.
6. Create a SQLite backup.
7. Reuse existing media rows.
8. Insert missing media rows.
9. Append playlist item rows.
10. Commit one transaction.
11. Print safe summary counts.

**Validation:**
- Run importer against production SQLite.
- Expect cached count growth only.
- Run importer a second time.
- Expect zero additions.

### Task 1.2: Document agent usage

**Why:** Future requests need one obvious procedure.

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

**Implementation steps:**
1. Document the manual command.
2. Document append-only behavior.
3. Document required permissions.
4. Document summary verification.
5. Prohibit scheduled execution.

**Validation:**
- Run: `git diff --check`
- Expect clean documentation formatting.

**Sprint completion check:**
- Run: `npm run test`
- Run: `npm run check`
- Run: `npm run build`
- Expect all commands pass.

**Plan update after sprint:**
- Completed the manual importer.
- Fetched 254 unique items.
- Appended 11 missing items.
- Increased cache from 243 to 254.
- Created a pre-import backup.
- Confirmed second-run idempotence.
- Passed 69 tests.
- Passed all type checks.
- Passed production builds.

**Sprint review answers:**
- Existing items remained cached.
- Manual additions remain preserved.
- The second run added zero.

## Final validation

- Confirm service remains active.
- Confirm SQLite cached count.
- Confirm working tree state.

## Risks / sequencing notes

- Root-owned secrets require `sudo`.
- Database backups remain local.
- Source deletions remain cached.
- Playlist order remains irrelevant.
