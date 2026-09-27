# EM32DX: Regular mode first, Party mode later

## Problem and desired outcome

Manage the owner's e-paper images in Show Manager, not Samsung's mobile image UI.
The display shares the Raspberry Pi's LAN and primarily runs on battery.
Regular mode is the priority: one image change per day, with roughly a week of
scheduled images or a fresh daily download. Party mode permits higher battery use
for more frequent, dynamic changes.

This replaces the earlier one-current/one-next, API-only prototype proposal.
A week schedule needs more than one pending entry. Routine management needs a
small browser UI in this project.

## Approved intent and current scope

- Required: plan first. No app installation, image replacement, or power changes yet.
- Required: one display; prioritize reliable daily battery operation.
- Required: choose images and schedules in Show Manager. Do not depend on Samsung's
  mobile app for routine content management.
- Required: support images created after installation, not only a preloaded bundle.
- Required: preserve Raspberry Pi slideshow and Android TV behavior.
- Historical owner observation: the display was connected to power at `192.168.68.125`
  for the recorded ping test. Recheck state before any approved device test.
- Examples: a seven-day cache is a useful starting size, not a hardware schedule limit.
  Daily fetch versus less frequent batch synchronization remains a battery trade-off.

## What is known

The Pi received three ping replies from the supplied display IP on 2026-09-27.
That proved IP reachability at that time while connected to power. It does not prove
battery wake, app installation, or a working control service.

Samsung documents EMDX/EMDXA as Tizen 8.0. Its Epaper API provides scheduled wake,
sleep, network standby, and explicit screen refresh. These methods require
Partner-level `http://developer.samsung.com/privilege/systemcontrol` access.

The official manual has now been read:

- Page 28 gives a 2.4 GHz remote-wake requirement for **EM32DX-A only**. It does not
  define a Pi-to-display protocol or rule out other behavior on the EM32DX.
- Page 35 requires the Samsung mobile app for initial setup. This is separate from
  routine content management; do not promise to remove every setup use of that app.
- Page 36 lists Sleep mode, Deep sleep mode, and Sleep mode off.
- Page 30 warns that Network Standby increases battery consumption.
- Page 29 says to allow about five minutes for screen stabilization. This is not a
  documented minimum image interval or an exact initial refresh duration.

The owner supplied Proshop's model code `LH32EMDIBGBXEN` and EAN `8806095804323`.
Samsung's support page for that code identifies it as EM32DX, not EM32DX-A.
The A-only remote-wake note is therefore not evidence for this unit. It also does
not prove that the non-A model lacks remote wake.
The owner now confirms **Custom Player** and **Developer Mode** on this Finnish
EM32DX with `S-RSEDWWC-1061.0`. This supersedes the earlier missing-menu report.
Custom app support is confirmed; no firmware update is needed to obtain these UI
features. App version and phone OS are not yet recorded.

TEP means Tizen Enterprise Platform. Basic individual Tizen development/testing is
supported by available evidence. Custom Player is a confirmed feature, but its exact
server/package protocol, non-debug signing, and persistence remain unverified.
Do not treat a Custom App URL as an arbitrary webpage or assume unsigned apps work.
Partner-restricted E-Paper hardware APIs are separate from basic rendering. No public
self-service route to individual Partner privileges has been identified.

The owner-supplied Samsung-branded setup-guide mirror describes `sssp_config.xml`,
a mandatory `size` field, a `.wgt`, and required `epaper.support=true` metadata.
The research record gives the exact metadata key and source limits. These findings
were supplied by the owner, not independently retrieved again in this update.
The retailer's 24-hour battery claim has no supplied test conditions; do not use it
to predict Regular-mode battery life.
See [research and evidence](../docs/em32dx-research.md).

## Recommended behavior

### Regular mode — first delivery

Use a short daily awake period, then return to a verified low-power state.
Remote wake is useful but need not block this mode if scheduled wake works.

Proposed baseline:

1. Wake before the daily change time, with a margin based on measured startup delay.
2. Read the latest schedule. Fetch today's new image and any known upcoming images.
3. Validate downloaded files before replacing valid cached content.
4. Show the image when due. Do not request another refresh for unchanged content.
5. Persist state, arrange the next wake, and sleep only after the safe refresh sequence.

Cache known images for approximately a week. This permits scheduled changes when
Wi-Fi or the server is temporarily unavailable. If today's dynamic image is absent,
use a valid cached image due for today; otherwise retain the current image.
The fallback and late-update policy need owner confirmation before implementation.

Compare two measured operating patterns before optimizing battery use:

- Daily wake, network check, and download only when content changes.
- Batch download of the known week, then daily local playback wakes with less frequent
  network checks. Schedule edits reach the device only at a later check or valid wake.

These are alternatives within Regular mode, not a requirement for a settings matrix.
Choose one obvious initial path from physical evidence. Do not build both policies
before the basic daily cycle is proven.

### Party mode — second delivery

The owner explicitly starts a temporary higher-power session. The display stays
awake or uses a verified network-standby mechanism and checks more often for images.
Choose a useful update interval after measuring panel behavior; do not promise a
rapid slideshow or second-accurate settled pixels.

Proposed safeguards: no overlapping refreshes, discard superseded pending work, and
set a Party end time that the device stores locally. It can then return to Regular
mode even if the server is unavailable. Exact duration and cadence remain open.

Important: starting Party mode in the web UI cannot wake a deeply sleeping display
unless a working remote-wake path exists. Without one, schedule Party mode before
the next daily wake or wake the unit physically. Show requested versus active mode;
do not claim that an offline display has received a change.

### Show Manager controls

Propose one trusted-admin e-paper page:

- Select/upload an image and assign a day or time.
- View and edit the upcoming week.
- See the latest device report, cached schedule, and pending changes.
- Later: start/end Party mode and show whether the device has accepted it.

A last reported image is not proof of the panel's current physical contents. A
battery reading, if available through a verified API, needs its observation time.
Guest QR sessions must not gain image publishing or device-control access.

## Proposed integration

```text
Show Manager UI + existing Express backend on VPS
                    |
       private delivery path, still to approve
                    |
     Raspberry Pi LAN endpoint/cache (candidate)
                    |
         EM32DX custom packaged player
         wake -> sync/cache -> update -> sleep
```

Keep schedule and content ownership in the existing Express app. A small Pi-side
manifest/image relay is a candidate because the display does not itself have the
VPS's tailnet access. It must not expose the full trusted admin API to the LAN.
No new Pi listener, service, or firewall rule is approved by this plan.

The manifest should describe a versioned schedule and immutable image URLs, rather
than only `{ imageUrl, showAt }`. It must permit a current image, upcoming entries,
and an agreed mode request. Final payload fields follow the wake feasibility test.
Daily dynamic images use the same publishing path when they become available;
image generation itself remains outside scope.

Use shared Zod schemas in `shared/show-schema.ts`, direct route-to-service flow,
repairable state under the existing data root, and the existing upload library.
Use strict TypeScript, existing UI primitives, and `web/src/lib/api.ts` for browser
requests. The display player stays small; it does not need React or a plugin layer.

## Delivery stages and acceptance

### 1. Custom Player protocol and basic installation

Required order for the next engineering work, after separate operational approval:

1. Log the Custom Player installation HTTP requests with a minimal local server.
   Initial 404 responses are sufficient. Record the entered URL and distinguish root
   `/sssp_config.xml` from `/app/sssp_config.xml` or any other observed path.
2. Establish the exact metadata request path and `sssp_config.xml` schema requirements.
   The mandatory `size` field is known from the supplied guide; its full schema is not.
3. Establish `.wgt` filename/package requests. Record methods, headers, order, retries,
   redirects, query parameters, and device-identifying headers. Do not invent filenames.
4. Build the smallest Tizen package with the required E-Paper support metadata:
   `http://samsung.com/tv/metadata/application/epaper.support` set to `true`.
5. Sign it through the normal Samsung/Tizen development certificate path. Do not assume
   a registered business or Partner certificate is required for basic rendering.
6. Serve metadata and package from the local HTTP server. Attempt Custom Player install.
7. Record all server responses and device messages, including failures.
8. Verify running → reboot → retained installation and automatic launch → power
   removal/restoration → retained installation and automatic launch. External-power
   removal alone is not a full power cycle on a battery device; record actual states
   and use an approved safe power-off procedure.
9. Verify Developer Mode dependency, certificate/runtime expiry conditions, and ongoing
   cloud/partner dependencies. Do not claim indefinite operation from a short test.
10. Separately test the E-Paper Developer Mode path: toggle on, development PC IP,
    display restart, then Tizen SDK debug installation. Treat it as debug/temporary
    until persistence is directly verified; do not merge its results with Custom Player.

Required: no `webapis.epaper.*` calls in the initial basic app. Only after basic
operation works, investigate which hardware API failures specifically require Partner
privileges. Declaring `systemcontrol` does not grant it.

Do not assume consumer-TV Developer Mode procedures, generic SDB procedures, USB
`.wgt` installation, URL Launcher, TV Seller Office deployment, consumer app-store
behavior, or hospitality-TV power APIs. Do not update firmware to obtain features
already visible on this device. The example `/app` layout is not a fixed contract.

Acceptance: retain a protocol trace and package/signing record for this exact model
and firmware. Record persistence outcomes for each deployment path separately.
No full installer server is needed before request discovery. Stop disposable servers
and remove fixtures after tests. Keep keys and sensitive logs outside Git.

Optional separate investigation: observe one official mobile-app image update at the
router/AP. Record LAN/cloud flows, ports, DNS, protocols, payload sizes, and discovery.
With separate approval, repeat with display Internet access blocked but LAN preserved;
restore rules afterward. Start with packet metadata, not TLS interception. This can
clarify transport architecture but does not replace Custom Player installation proof.

### 2. Privileged battery feasibility

Basic installation does not prove battery scheduling. Resolve access to the required
Partner privileges before using hardware-control calls. If access is unavailable,
record that blocker and discuss alternatives; do not claim basic apps are impossible.
Then resolve scheduled-wake app launch and safe refresh/sleep behavior.

With owner approval and the needed privileges, prove:

- A newly downloaded image can be stored and shown through the correct panel path.
- A wake scheduled while awake survives battery sleep and relaunches/resumes the app.
- Cached content works after restart and without Wi-Fi.
- Failed sync does not leave the unit awake indefinitely or cancel its next wake.
- The device can safely sleep after refresh. An API return alone is not completion.
- Repeated battery cycles work without physical input. Record awake duration, refresh
  duration, network activity, and measured battery use over an agreed period.

Test remote wake separately. A failure there must not block Regular mode if scheduled
wake meets the need. If neither wake path can run the custom app, stop and discuss a
supported alternative. Do not substitute permanent external power silently.

### 3. Regular mode end to end

Implement the small UI, publish API, private delivery path after approval, and player.
Acceptance examples:

- A week scheduled in Show Manager reaches the cache. Daily images change without
  Samsung's image-management UI, including during a temporary network outage.
- A newly generated daily image downloads during the next awake check and follows
  the agreed timing/fallback policy.
- Partial downloads, invalid manifests, storage failures, or stale completions never
  replace valid content. Interrupted state writes recover safely.
- Duplicate schedules cause no unnecessary download or refresh. Cleanup keeps every
  file needed by the active offline schedule, with bounded staging and storage use.
- A changed schedule replaces the old schedule only when its required assets are
  ready. The UI shows changes pending until the device reports acceptance.
- Daily local time handles timezone and daylight-saving changes explicitly. Restart
  or clock correction selects the applicable image, not a burst of missed refreshes.
- Public and QR-session requests cannot publish or control the display.

### 4. Party mode

Add dynamic updates only after Regular mode is accepted. Verify entry from the actual
Regular sleep state, superseded requests, refresh pacing, network loss, and return to
Regular mode at the agreed end time. Measure the battery cost; do not promise a
battery lifetime from a powered test.

## Constraints and open decisions

- Required: no generic device framework, multiple displays, video, template editor,
  cloud service dependency, firmware update, or unrelated application changes.
- Required: no broad public/LAN exposure of the existing backend. Requests without
  its public-access header are trusted, so an unrestricted proxy would be unsafe.
- Required: use Samsung's supported setup path. No PIN guessing, authentication bypass,
  secret collection, factory reset, or destructive USB import as a discovery step.
- Confirmed ordered model: EM32DX, `LH32EMDIBGBXEN`.
- Owner-reported firmware: `S-RSEDWWC-1061.0`; Custom Player and Developer Mode confirmed.
- Open — installation: exact URL/XML/package protocol, normal development signing
  result, non-debug signing requirements, persistence, autolaunch, Developer Mode
  dependency, certificate lifetime, and ongoing cloud/partner access.
- Open — hardware: mobile-app version/phone OS, Wi-Fi band, sleep setting,
  firmware-specific API support, and access to Partner privileges for hardware control.
- Open — owner: daily change time and timezone, portrait/landscape use, and fallback
  when today's dynamic image is unavailable. Decide whether late images wait for the
  next daily check or warrant another wake.
- Open — measurement: daily fetch versus batch synchronization, acceptable battery
  life, and Party cadence. No hard values are inferred from the manual.
- Worker-owned after approval: local module structure, atomic cache/state handling,
  bounded retry implementation, fixtures, and focused tests within the agreed contract.
- Escalate: unsupported wake/install behavior, new dependencies, host operations,
  network exposure, paid access, credentials, or changes to the agreed mode behavior.

## Validation and status

Use temporary data roots, mocked device APIs, deterministic time tests, and Supertest.
Run `npm run test`, `npm run check`, and `npm run build` after code changes.
Use isolated local browser fixtures for the management UI. Do not add browser E2E
tooling without need. Physical refresh, sleep, and battery claims need the real unit.

A coherent advanced implementation assignment can own code, tests, fixtures, and
supporting docs after the contracts are resolved. Worker checks precede exact-run
review and supervisor acceptance. Live device changes need separate approval.

- Complete: source/manual research and powered IP reachability check.
- Model resolved: EM32DX `LH32EMDIBGBXEN`; owner reports `S-RSEDWWC-1061.0`.
- Not complete: custom-app installation, battery wake, or code. No app scaffold exists.
- No worker or review is active. Only documentation changed; nothing was committed.
- Complete: owner findings reconciled into this plan and research. Firmware UI support
  is resolved. Protocol, signing, persistence, and Partner access remain separate checks.
- Next outcome: obtain approval for a bounded Custom Player HTTP request trace, then
  a minimal non-privileged package test. Regular mode does not depend on Party success.
- Resume from [the session handoff](../docs/em32dx-handoff.md).
- Next-context choice: continue. Current context contains the reconciled findings and
  the bounded next test. No implementation or device operation is authorized yet.
