# EM32DX session handoff

## Resume here

Read repository `AGENTS.md`, then:

1. [Current plan](../plans/2026-09-26-em32dx-prototype.md) — intent, stages, and acceptance.
2. [Research record](em32dx-research.md) — source attribution, device findings, and history.

The owner's external findings are now incorporated. Do not repeat the missing-menu
investigation or powered ping without a new evidence gap. The next useful result is
an approved Custom Player HTTP request trace, followed by a minimal basic package.

## Current status

- Device: plain Samsung **EM32DX**, `LH32EMDIBGBXEN`, Finland. Not EM32DX-A.
- Firmware: owner reports **`S-RSEDWWC-1061.0`**.
- **Custom app support: CONFIRMED.** The owner sees Custom Player and Developer Mode
  in the connected Samsung E-Paper mobile app. This supersedes the missing-menu report.
  Do not recommend a firmware update to obtain these features.
- **Individual basic Tizen development/testing: SUPPORTED BY AVAILABLE EVIDENCE.**
  Basic rendering and normal development signing are separate from Partner APIs.
- **Custom Player installation: CONFIRMED AS A DEVICE FEATURE.** Exact server/package
  protocol and non-debug signing requirements are still being verified.
- **Permanent installation across reboot: NOT YET VERIFIED.** Neither automatic launch
  nor persistence after a full power cycle has been tested.
- **Privileged E-Paper hardware APIs: PARTNER-RESTRICTED.** No public self-service route
  for individual Partner privileges has been identified.
- App version, phone OS, and certificate access remain unrecorded.

The new findings are owner-supplied research and observations, not new assistant device
checks. The Samsung-branded setup guide is hosted on a third-party mirror. Keep it
distinct from Samsung-hosted references. The reported individual-owner app success is
corroboration only; no report URL or signing/persistence procedure was supplied.

## Next bounded test

Planning does not authorize execution. With separate owner approval:

1. Use an empty local HTTP root and log Custom Player requests, initially returning
   404 if needed. Capture methods, paths, headers, order, retries, redirects, queries,
   and later package requests. Record entered URL, model, firmware, and device messages.
2. Resolve `sssp_config.xml` path/schema and `.wgt` request behavior before writing a
   full installer server. The guide findings require `size`, but do not establish its
   placement or the complete schema. `/app/SomeApplication.wgt` is only an example.
3. Build a minimal HTML/JavaScript Tizen package with this metadata:

   ```xml
   <tizen:metadata
       key="http://samsung.com/tv/metadata/application/epaper.support"
       value="true"/>
   ```

4. Use the normal Samsung/Tizen development signing path. Serve metadata and package,
   attempt Custom Player installation, and record all server/device responses.
5. Test running → reboot → installation and automatic launch → power removal/restoration
   → installation and launch again. Unplugging external power is not a full power cycle
   on a battery device. Use an approved safe power-off procedure and record actual states.
6. Check whether Developer Mode must remain enabled, certificate expiry affects runtime,
   or continued operation needs Samsung cloud/partner access. Short tests do not prove
   indefinite operation.
7. Test Developer Mode deployment separately: enable it, enter the development PC IP,
   restart the display, then use Tizen SDK debug installation. Treat it as debug/temporary
   unless persistence is directly verified.

Do not use `webapis.epaper.*` initially. After basic operation succeeds, investigate
Partner-restricted APIs separately. Do not assume generic TV Developer Mode, SDB,
USB `.wgt`, URL Launcher, TV Seller Office, or consumer app-store deployment applies.

Optional separate evidence: capture one official-app image update at the router/AP.
Inspect LAN/cloud traffic and discovery metadata. A later, separately approved test
can block display Internet access while retaining LAN access. Restore rules afterward.
Do not start with TLS interception. See the research record for the capture checklist.

## Product intent that remains unchanged

- **Regular mode first:** one daily image change, about a week of cached schedules or
  daily dynamic fetch. Measure daily versus batch sync and battery use.
- **Party mode later:** more frequent changes with higher battery use. Cadence and
  proposed local end time remain open.
- Show Manager owns routine images and schedules. Samsung's mobile app remains part
  of initial setup and the evidenced installation workflow.
- The existing Express backend owns schedules. A narrow Pi LAN relay is a candidate,
  not an approved listener, service, firewall change, or deployment.
- Scheduled wake may support Regular mode without remote wake, but requires verified
  API access and physical tests. Do not promise Party activation during deep sleep.
- The manual's EM32DX-A-only remote-wake note does not establish this non-A unit's
  behavior. Retained panel content is not proof that an app is running.
- Five-minute stabilization guidance is not a fixed minimum image interval. Retailer
  battery claims do not predict the planned workload.

## Historical network evidence

The display shares the Pi LAN. Last recorded Pi Wi-Fi IP: `192.168.68.126/24`.
Display IP: `192.168.68.125`; neighbour MAC: `00:7d:3b:72:f5:dc`.
On 2026-09-27, all three ping replies arrived while externally powered. This proves
neither a control service nor battery wake. Addresses and current power state can change.
The detailed commands remain in the research record; no new probes ran in this update.

## Workspace and safety

This work changes only these uncommitted documentation files:

- `plans/2026-09-26-em32dx-prototype.md`
- `docs/em32dx-research.md`
- `docs/em32dx-handoff.md`

No app scaffold, dependency, device installation, image change, firmware update,
reset, power-setting change, or host service change was made. No credentials or PINs
were collected. No worker or review is active. Documentation validation covers source
attribution, consistency, local links, and whitespace; no application runtime is changed.

Ask before device operations, credentials, paid enrollment, captures, network-policy
changes, or network exposure. Keep test servers off the Internet. Stop them after use,
remove disposable fixtures, restore test rules, and keep keys/private captures out of Git.

The manual URL and saved PDF snapshot ID are in the research record. Read the PDF again
before making new source-specific claims. Saved IDs are branch-scoped; a new session
may need the public URL. The existing manual findings were retained, not newly verified.

The plan records the next-context choice and remaining product decisions.
