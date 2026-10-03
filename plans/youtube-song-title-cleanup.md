# YouTube song-title cleanup

## Problem

YouTube titles contain channel names and video metadata.
The playlist UI also adds an artist or channel prefix.
Stored titles can change when the TV reports playback metadata.
This makes Upcoming and Now Playing titles noisy or repetitive.

## Desired outcome

Show music titles as `Artist - Song Title`.
Keep the original source title in storage.
Apply cleanup to new items and existing stored data.
Do not change playlist membership or playback state.

## Approved behavior

- Required: Keep original titles. Store the cleaned display title separately.
- Required: Cover new YouTube additions, saved playlist media, and the active queue, including Now Playing.
- Required: Include explicit cleanup of existing data. The user's request overrides the pasted exclusions for existing entries.
- Required: Use OpenRouter model `~z-ai/glm-flash-latest` (canonical API alias for the same user-requested Z.ai: GLM Flash Latest model) and the supplied instruction below.
- Required: Use a low temperature, a short output token limit, trimmed output, and a bounded request timeout. Disable unnecessary provider reasoning with `reasoning: { enabled: false }`; keep the existing 160-token budget.
- Required: Missing credentials, request failures, invalid responses, or empty output must not prevent additions. Fall back to the original title.
- Required: Keep the API key on the server. Read `OPENROUTER_API_KEY` from the process environment. Never expose or log it.
- Required: Keep the model name in a code constant. This meets the request without another environment setting.
- Required: No retries, background cleanup queue, confidence scoring, or cleanup calls during reads, search enumeration, startup, playlist loading, or playback polling.

## Source findings

- `server/src/routes/youtube-queue.ts`: URL additions currently pass only video ID and canonical URL. Search-result additions pass title and metadata. Pippalot has its own URL-add route.
- `server/src/services/youtube-search-service.ts`: search supplies video titles and structured song artist/name metadata. Native `fetch` is already used for HTTP requests.
- `server/src/services/youtube-store.ts`: saved playlist and queue entries reference shared media rows. Confirmed videos have a separate catalog table. Media upsert and playback updates can overwrite titles. Radio copies catalog metadata into media rows.
- `shared/show-schema.ts`: shared Zod payloads currently have no separate display title.
- `web/src/components/upcoming-queue.tsx`: the title formatter adds artist or channel before the stored title.
- `web/src/components/playlist-manager-mock.tsx`: Now Playing uses that formatter for a managed queue item. Without one, it shows the raw TV title.
- `scripts/pippalot-import-new.mjs` and `scripts/youtube-backfill-confirmed.mjs`: direct SQLite writers must preserve the new title contract.
- `server/src/config.ts`: configuration reads process environment only.
- `deploy/systemd/show-manager.service`: existing EnvironmentFile entries do not load `$HOME/.config/secrets/openrouter.env`.

These findings come from repository source, not current production data.

## Proposed implementation

1. Keep `title` as the raw source title and add nullable `displayTitle` through storage and shared payloads. Update writers so playback, re-addition, radio, and imports cannot overwrite a captured original or erase its display title. Playback observations stay separate from preserved source titles.
2. Add one small server-side title-preparation function. For a bare URL, fetch the YouTube title by video ID before saving; this lookup is currently missing. For video search selections, use their source title. Reuse a stored cleaned title for the same video ID. Prepare metadata before entering SQLite transactions or scheduler control ordering.
3. Call OpenRouter for a new video title before persistence. Store the original and successful cleaned result separately. If metadata lookup also fails, retain the existing ability to add a title-less URL item.
4. Prefer `displayTitle` directly in Upcoming and managed Now Playing. Do not prepend the artist or channel again. With no cleaned title, show the original video title; use video ID only when no title exists.
5. Provide one explicit existing-data cleanup command. Process unique video IDs sequentially in explicit bounded batches with visible progress and write only title-related fields. Keep source values intact. Fetch missing source titles from YouTube. Skip successful results on later runs; failures stay usable and are reported. Do not hold a database transaction across HTTP requests. No count preview, backup, or staged apply workflow is required for this cleanup.

Worker-owned: helper structure, metadata lookup mechanism, focused tests, and internal SQL details. Prefer existing dependencies and native `fetch`.

## Scope and exclusions

- Included: title storage, addition flow, existing-data cleanup, and existing playlist/queue title presentation.
- Required: include the full confirmed-video catalog and future manual imports so radio does not reintroduce raw titles. Preserve source titles in both catalog and media rows.
- Required: format structured YouTube Music results directly from artist and song name without an OpenRouter call.
- Excluded: a new saved-playlist editor, AI cleanup of every search result, and continuous cleanup of unmanaged TV playback.
- Excluded: Pippalot source synchronization, playlist replacement, queue clearing, media downloads, and TV/Raspberry Pi control changes.
- Authorized after implementation review: paid OpenRouter calls and existing-data title writes, including missing-title retrieval. The user accepts the cost and data risk; provider spending limits are already set.
- Excluded until separately approved: service installation/restart and host configuration changes.

## Acceptance examples

- Example: `Century Media Records - MARDUK - Shovel Beats Sceptre (OFFICIAL VIDEO)` remains stored as the original. Upcoming and Now Playing show `MARDUK - Shovel Beats Sceptre` without a channel prefix.
- Example: an OpenRouter outage leaves addition working and shows the original fetched title.
- Example: cleaning an existing video updates its display across saved playlist references and queue occurrences. Entry IDs, order, current track, statuses, timestamps, and persisted pause remain unchanged.
- Example: a subsequent playback poll or radio load does not erase the original or cleaned display title.
- Example: a repeated cleanup run skips previously successful results.

## Constraints and open decisions

- Required: Do not claim recovery of historical originals. Playback and other writers may already have replaced them. Preserve the current stored value; a fresh YouTube lookup cannot recover the former historical title.
- Required: No count preview or backup requirement for this cleanup. Do not remove backups from the existing Pippalot synchronization command, which has a separate project requirement.
- Required: No external calls or bulk title rewrites on startup. Document the small additive schema change and explicit cleanup command.
- Required: keep non-music titles unchanged. Preserve meaningful song qualifiers such as live, remix, or featured artists. Do not add a classifier or confidence system.
- Required: support `OPENROUTER_API_KEY` from the environment and the existing server-only secret at `$HOME/.config/secrets/openrouter.env` when it is not exported. Prefer the environment. Do not expose, log, or copy the real secret into repository files. A narrow loader is acceptable to avoid requiring a host service change.
- Required: missing-title retrieval and paid cleanup of the full existing catalog are approved without a count or extra spending approval.
- Escalate: dependency additions, credential permission changes, and live operations beyond approved title cleanup.

## Validation and delivery

One implementer owns the code, tests, supporting docs, and synthetic-fixture validation after approval.
Use temporary SQLite databases and mocked metadata/OpenRouter/ADB responses.
Cover successful cleanup, whitespace trimming, failures, original preservation, shared-row propagation, restart persistence, duplicate titles, and unchanged playback/queue identity.
Verify UI display without repeated artist/channel prefixes and no provider calls on reads or playback ticks.
Test the explicit command, rerun behavior, missing-title retrieval, and preservation with synthetic data.
Run `npm run test`, `npm run check`, and `npm run build`.
Require exact-run static review and supervisor acceptance before completion.
Run the approved existing-data cleanup after implementation review and acceptance. No service restart or host change is authorized.

## Exact model instruction

```text
You clean up YouTube music video titles.

Return only the cleaned title in this exact format:
Artist - Song Title

Remove unrelated text such as:
- record label/channel names
- OFFICIAL VIDEO / OFFICIAL MUSIC VIDEO / OFFICIAL AUDIO
- lyric video / visualizer
- resolution tags such as 4K or HD
- redundant repeated artist names
- unnecessary brackets or parentheses containing video metadata

Preserve the actual artist name and song title.

Examples:

Century Media Records - MARDUK - Shovel Beats Sceptre (OFFICIAL VIDEO)
=> MARDUK - Shovel Beats Sceptre

Dark Funeral - Let the Devil In
=> Dark Funeral - Let the Devil In

Marilyn Manson - The Fight Song
=> Marilyn Manson - The Fight Song

Marilyn Manson - Marilyn Manson - Front Toward Enemy (Music Video)
=> Marilyn Manson - Front Toward Enemy

Nuclear Blast Records - SEPTICFLESH - Neuromancer (OFFICIAL MUSIC VIDEO)
=> SEPTICFLESH - Neuromancer

Nuclear Blast Records - KREATOR - Gods Of Violence (OFFICIAL VIDEO)
=> KREATOR - Gods Of Violence

Return only the final cleaned title. Do not include quotes, JSON, markdown, explanations, or any other text.
```

## Provider compatibility evidence (supervisor-supplied)

The supervisor reported live HTTP 400 for the former spelling `z-ai/glm-flash-latest`: `z-ai/glm-flash-latest is not a valid model ID`.
A parent public native-fetch lookup of `https://openrouter.ai/api/v1/models` at `2026-10-02T09:44:01Z` returned ID `~z-ai/glm-flash-latest`, name `Z.ai: GLM Flash Latest`.
One parent authenticated smoke request with this canonical alias, the existing exact prompt, temperature `0.1` and `max_tokens: 160` returned HTTP 200, resolved response model `z-ai/glm-5.3-flash`, `finish_reason: stop`, content `MARDUK - Shovel Beats Sceptre`, and 75 completion tokens.
This establishes API compatibility for the same intended model alias, not authorization to substitute a model. It was one smoke title request, not full existing-data cleanup. The supervisor reported no database writes or service operations. The worker did not repeat these live operations or access credentials.

## Follow-up: bounded cleanup and missing artists

The full cleanup command was interrupted by the user because it ran for a long time without progress output. No cleanup process remains active. Any successful title writes before interruption remain saved; no final summary was produced.

Required: provide bounded batches with visible progress and a short final summary. Do not add a background queue or retry system. Prioritize the active queue for the next approved batch.
Required: preserve stored originals, but use current YouTube metadata when a legacy song-only title lacks artist context. Do not assume a channel is the artist; label channels are common.
Required: permit a bounded targeted refresh of an already saved poor display title. Normal successful-title reuse must remain unchanged. Do not repeatedly reprocess legitimate non-music titles by default.

Parent read-only inspection found `Bite Me!` already saved unchanged as display text, and `In Fire Reborn`, `Need Some1`, and `The Chosen Legacy` stored without artists or display titles. Public oEmbed retrieval identified canonical music titles with Hocico, The Haunted, The Prodigy, and DIMMU BORGIR respectively. The Nuclear Blast channel is not the artist for The Chosen Legacy.

The user approved this follow-up. Implement, test, and review the bounded command and metadata fix before resuming live cleanup.

Implementation choices: the command defaults to 25 unique IDs (`--limit 1..100`), with Now Playing then Upcoming priority, and numeric-only progress at start, first completion, every five and final completion. Normal selection excludes successful displays. Repeated `--refresh VIDEO_ID` targets only requested existing IDs, within the limit, and permits successful display replacement without changing originals. SIGINT/SIGTERM abort in-flight fetch and return partial summary/exit 130; earlier per-ID transactions remain committed. No transaction spans HTTP.
Preparation uses canonical oEmbed title as provider context for uncleaned bare titles without structured artist/name or explicit targeted refresh. The separator check triggers enrichment, not music classification. Lookup failure leaves the original/previous display usable without blind model artist inference. Structured song preparation and refresh remain local; UI fallback uses artist/name only, never channel.
Focused fixtures cover batch/default bounds, progress, active priority and unique references, targeted refresh/normal success skip, canonical title context for all four reported examples (including label channels), lookup/truncation failures, structured bypass, original/timestamp/state preservation, and actual synthetic command interruption/rerun.

## Earlier implementation and live evidence

All prior implementation runs, through the non-reasoning follow-up, passed exact-run review and supervisor acceptance. Final worker validation passed 80 focused tests, 262 full tests, type checks and builds. Parent reconciled all 19 feature-file hashes before review.
Exact final source hashes and command output are retained in git-ignored `youtube-title-noreasoning-20261002-1326.log`. Earlier evidence remains in the bounded, rework and canonical-ID logs.

Parent live command completed one targeted batch of four IDs (`--limit 4` with the four reported `--refresh` IDs). Summary: selected 4, processed 4, cleaned 4, refreshed 1, failed 0, notFound 0, interrupted false. Parent read-only verification confirmed `Hocico - Bite me!`, `The Prodigy - Need Some1`, `DIMMU BORGIR - The Chosen Legacy`, and `THE HAUNTED - In Fire Reborn` as saved display titles.

Full catalog cleanup remains incomplete. The earlier unbounded command was interrupted without a final summary; successful partial writes remain. The next parent-run normal batch (`--limit 25`) completed: selected/processed 25, cleaned 20, failed 5, interrupted false. Progress was reported at 0/1/5/10/15/20/25. Failed entries remain usable; no automatic retry or full-catalog loop was run. No cleanup command or dependent worker/review remains active at this gate.

The user approved restarting only `show-manager` and running this 25-item batch. Parent ran `sudo -n systemctl restart show-manager` on 2026-10-02 at 13:19:52 UTC. PID changed from 676520 to 721115; the unit stayed active/enabled. Before/after `/status` and `/api/status` returned 200; public queue access without a session returned 401. The live queue response passed the new shared title schema after restart. Listener addresses remained `127.0.0.1:4791` and the existing tailnet proxy address `100.65.130.34:4791`. One initial connection refusal during startup recovered through the bounded readiness check. No service settings, firewall, proxy, packages, Pi/TV configuration or unrelated services changed.

Earlier raw-title drift: `Ifi4DtLLKpM` changed from `Bite Me!` to `Bite Me! (Live in Berlin)` between parent inspections. Cleanup only fills missing originals and does not explain that replacement. The exact writer was not established. The restarted runtime now exposes the new title contract and preservation code; no historical-original recovery is claimed.

The user approved paid cleanup and missing-title retrieval, with no count preview or new backup. Pippalot sync retains its separate manual-only and backup rules. Worker checks used synthetic fixtures only; live quality is established for these four results, not the full catalog. Interactive browser/device behavior remains unverified.

Follow-up live diagnosis: the user reported more missing artists. Parent targeted preparation for `AFHjaVJEZqA` and `SnTL1L8a6YI` cleaned `PAIN - Same Old Song`; Behemoth failed because OpenRouter returned `finish_reason: length`, only two content characters and 160 completion tokens. The incomplete result was correctly rejected; no display was stored for Behemoth.

A parent probe fetched canonical metadata `BEHEMOTH - Blow Your Trumpets Gabriel (Official Music Video)CENSORED` and used the same model/prompt/temperature/max_tokens with `reasoning: { enabled: false }`. It returned HTTP 200, `finish_reason: stop`, `BEHEMOTH - Blow Your Trumpets Gabriel`, 12 completion tokens and zero reasoning tokens. This was a diagnostic call, not a stored-title update; Behemoth was still unresolved at that point. The worker did not repeat live calls, read credentials/data, run live cleanup or operate services/devices.

The implementation adds only this fixed request setting; model alias, exact prompt, temperature, output budgets/timeouts, truncation rejection, batching/context/fallback/secret/original behavior stay unchanged. Literal outgoing-body assertions and a synthetic two-character truncation followed by explicit success verify the setting without treating disabled reasoning as permission to accept incomplete output. No retries, classifiers, token-budget expansion, dependencies or configuration matrices were added.

After acceptance, parent ran the built command with `--limit 1 --refresh SnTL1L8a6YI`. Summary: selected/processed/cleaned 1, failed 0, interrupted false. Parent read-only verification confirmed saved displays `BEHEMOTH - Blow Your Trumpets Gabriel` and `PAIN - Same Old Song`, with their stored original titles unchanged.

The user authorized another restart to activate the non-reasoning request in the backend. Parent ran `sudo -n systemctl restart show-manager` at 2026-10-02 13:41:19 UTC. PID changed from 721115 to 725616; the unit is active/enabled. Before/after `/status` and `/api/status` returned 200, public access without a QR session returned 401, and listener addresses remained unchanged. One startup connection refusal recovered through the bounded readiness check. No service settings or other units changed; no additional cleanup batch ran.

The CLI and backend now use the fixed request. No cleanup command, service operation, dependent worker or review remains active at this gate. Full catalog cleanup remains incomplete.

## Follow-up: use all stored artist context and complete the queue

The user clarified that every music title must show `Artist - Song Title` when available data supports it. Parent inspection found 130 unique active/pending queue videos: 102 with no display and 9 with saved song-only displays. Counts describe this inspection, not a fixed dataset.

For the new screenshot examples, media stores bare titles but the same-ID confirmed catalog already stores `Deicide - Scars Of The Crucifix`, `Rammstein - Angst (Official Video)`, and `SLAYER - Pride In Prejudice (OFFICIAL MUSIC VIDEO)`. Current source selection ignores this fuller catalog context. Several saved bare displays likewise have full catalog titles (Judas Priest, Till Lindemann, ABBATH, STRAPPING YOUNG LAD, BEHEMOTH, PAIN, DARK FUNERAL, CENTHRON).

Required: retain each original baseline, but use fuller same-video stored catalog/source metadata for cleanup before a new lookup. Structured artist/song formatting stays local. Do not mechanically treat channels as artists.
Required: repair legacy saved artist-less displays when available music metadata establishes the artist/title. They must not be treated as completed successes forever. Do not endlessly reprocess legitimate non-music displays or add a classifier/confidence system.
Required: music cleanup with known artist context must produce both artist and song components, not silently mark a bare song result successful. Keep any format check small and retain usable source fallback; no automated retries or extra framework.
Required: after implementation review, complete the remaining current queue across visible bounded manual batches, with progress and evidence between batches. Stop and report unresolved failures instead of repeatedly spinning over them. Do not claim full catalog completion from queue completion.

### Stored-context implementation (accepted after correction)

`readYoutubeTitle` now separates the preserved first original baseline from fuller same-ID media/catalog source context, retains real artist metadata, and selects a complete sibling display when one exists. The shared small two-component predicate is used only with real artist/name, stored music kind plus full source context, or confirmed source context for normal eligibility; a hyphen or channel alone does not classify an arbitrary video as music. Normal batches inspect local metadata with this same rule, preserving active priority and the paid-work bound. Known incomplete saved displays are repaired rather than skipped. Other complete sibling/concurrently saved displays are retained by per-row writes; explicit refresh still replaces requested successes. Provider/source failures keep every original and previous display usable, with known incomplete rows eligible for a later explicit invocation.

Structured artist/name formatting remains local, including real stored artist/name when a legacy media kind says video, without adding a repeated identical artist prefix. Fuller stored or supplied context precedes oEmbed, including refresh when enough context is already stored. Confirmed import marks its known source role before insertion, rejects incomplete music output, preserves the newly supplied catalog original independently from a media baseline, and never copies a known incomplete display into a new confirmed row.

Worker-owned eligibility choice: an arbitrary saved video with only a channel and bare title has no machine-known artist/music context and remains a skipped success, protecting legitimate nonmusic. The supervisor's known `Residue` example (`2fALV3X9jB4`, no catalog) uses the existing bounded `--limit 1 --refresh 2fALV3X9jB4` to retrieve its canonical artist-bearing metadata; no ID whitelist, channel-to-artist mapping or classifier is added. The eight fuller-catalog saved examples need no explicit refresh.

Focused synthetic coverage includes all three screenshot examples and eight saved bare/catalog examples, original/timestamp/queue/pause preservation, no oEmbed with full catalog context, ordinary repair and rerun skip, valid sibling reuse, local structured formatting, canonical Residue recovery without catalog, nonmusic success skip (including unrelated separator titles), two-component rejection, provider/source failures, concurrent-success preservation, future confirmed import capture, actual normal bounded CLI batches, counter-only output, interruption and rerun. Fixture hooks close SQLite handles, remove temporary roots (including synthetic secrets, fetch hooks and existing importer backups) and assert that the roots no longer exist. Child process exit is awaited; existing interrupt watchdogs are cleared.

Worker/run: `gpt-6.1-sol`, session `01a0fbdd-34f4-723d-8ebb-4bd4f378527f`, run `youtube-title-storedcontext-20261002-2120`, repository `/mnt/HC_Volume_105934557/workspace/projects/show-manager` (host repo alias `/home/devops/workspace/projects/show-manager`). Exact final source hashes, command output and runtime origin are retained in git-ignored `youtube-title-storedcontext-20261002-2120.log`. At worker handoff this follow-up awaited review. It is now accepted together with the music-kind correction below. No worker live database/credentials/network, cleanup, services/devices or git commits. Live model quality, interactive browser/device behavior and queue/catalog completion are not established by synthetic tests.

After acceptance, the supervisor owns visible bounded manual queue batches and the canonical Residue target, reconciliation between batches, and stopping/reporting unresolved repeated failures. Queue completion does not imply full catalog completion.

### Review correction: stored music kind/full source, missing artist/catalog

Review of the stored-context run identified an eligibility/guard gap: a media row with `kind='music'`, null artist, full title `Artist - Song (Official Video)`, no catalog and saved display `Song` was skipped; ID-only cleanup of a missing display could accept the same bare provider result that direct music preparation rejected. The previous run is not accepted as evidence that this case worked.

The correction adds stored music kind plus full same-video source context to `readYoutubeTitle` validity. Media kind is retained independently from the selected original title. Preparation carries that stored music kind into ID-only/video-shaped inputs, so source enrichment and the completion guard agree with direct music preparation and re-addition cannot erase the known role. Writes apply the same known-context guard, retaining old displays on invalid candidates even during explicit refresh; normal complete sibling/concurrent displays stay preserved. No channel inference, universal separator classifier, new schema/configuration, dependency, retry, backup or count preview is added.

Eight additional synthetic regressions cover normal saved-bare repair without catalog, paired direct/ID-only missing-display rejection and later explicit success, stored-kind propagation through canonical enrichment/video-shaped re-addition, invalid-write rejection, valid sibling reuse, concurrent-success preservation and identical nonmusic separator-source skip. Full media snapshots and queue/playlist/meta snapshots establish original, state, membership and timestamp preservation. Literal outgoing-body assertions retain the same model/prompt/temperature/budget/disabled reasoning. All fixture roots are removed and verified absent after handles/children close.

The new tests first reproduced six failures against the prior source; the nonmusic control passed. Red output is retained in `youtube-title-musickind-red-20261002-2138.log`. Current focused validation passed 115 tests. Fresh exact final hashes, full validation output and runtime origin are retained in git-ignored `youtube-title-musickind-20261002-2143.log`, run `youtube-title-musickind-20261002-2143`, worker `gpt-6.1-sol`, session `01a0fbdd-34f4-723d-8ebb-4bd4f378527f`, actual repository `/mnt/HC_Volume_105934557/workspace/projects/show-manager`.

This correction and the stored-context follow-up passed fresh exact-run review and supervisor acceptance. Final worker validation passed 115 focused tests, 297 full tests, type checks and builds; parent reconciled all 19 feature-file hashes. The worker performed no live operations.

## Current status

Parent completed the queue cleanup after acceptance. The first normal 25-item batch cleaned 23 and reported 2 failures. A remaining-queue snapshot of 86 IDs was processed in visible batches of 25/25/25/11 using the accepted title service: 85 cleaned and 1 unresolved. Each snapshot ID was attempted once; Residue used explicit canonical refresh. A temporary work file tracked remaining IDs and was removed at completion.

Parent used unambiguous confirmed catalog titles to repair three unresolved earlier/current items directly, with no more provider calls: `Deicide - Scars Of The Crucifix`, `Rammstein - Angst`, and `BRIAN POSEHN - More Metal Than You`. Stored originals remained unchanged.

Final parent read-only database and live API checks found 127 unique active/pending queue videos, zero artist-less displays, and zero current queue IDs needing cleanup. Whole catalog cleanup is still incomplete; queue completion does not establish full-catalog completion. No cleanup command, dependent worker or review remains active.

The CLI uses the accepted stored-context and music-kind fixes. Backend activation of these last changes awaits permission for another restart of only `show-manager`. No further restart or full-catalog loop was run.

Next context: continue. The completed queue verification and pending backend activation are needed for the next step.
