# Samsung EM32DX research

## Conclusion

Custom app support is confirmed by the owner's device UI findings on the plain
EM32DX with firmware `S-RSEDWWC-1061.0`. Basic individual development/testing is
supported by available evidence. Installation protocol, signing for non-debug use,
and persistence still need verification. Partner-level hardware control is a
separate question; it must not block the first basic rendering test.

Do not promise a working EM32DX installer, boot launch, or exact refresh timing yet.

## Current device facts

- Ordered model: EM32DX, `LH32EMDIBGBXEN`, not EM32DX-A.
- Owner-reported software: `S-RSEDWWC-1061.0`.
- Region: Finland. The owner now confirms **Custom Player** and **Developer Mode**
  in the connected Samsung E-Paper mobile app. This supersedes the earlier report
  that no Custom App/TEP setting could be found. App version and phone OS remain unknown.
- Last reported power state: connected to external power for investigation.
- Display IP: `192.168.68.125`. Powered ping succeeded from the Pi; battery wake is
  untested. These are historical observations, not a live status feed.
- Next result: observe Custom Player HTTP requests, then test a minimal signed package.
- Resume from [the handoff](em32dx-handoff.md).

The reported UI resolves the feature-availability question for this unit on `1061.0`.
Do not state that a firmware update is needed for Custom Player or Developer Mode.
No firmware upgrade, reset, app installation, or credential action occurred in this
documentation update.

## New owner-supplied findings

These findings come from the owner's supplied research and device observations.
The linked pages were not fetched again for this update. Guide-specific claims below
are attributed to that research, not to a new assistant test or source retrieval.

| Topic | Current status |
| --- | --- |
| Custom app support | **CONFIRMED** by the reported device UI. |
| Individual basic Tizen app development/testing | **SUPPORTED BY AVAILABLE EVIDENCE**; not yet tested here. |
| Custom Player installation | **CONFIRMED AS A DEVICE FEATURE**; server/package protocol still being verified. |
| Permanent installation across reboot | **NOT YET VERIFIED**. |
| Privileged E-Paper hardware APIs | **PARTNER-RESTRICTED**. |
| Individual access to partner privileges | **NO PUBLIC SELF-SERVICE ROUTE IDENTIFIED**. |

### Two deployment paths

TEP means **Tizen Enterprise Platform**. The product's Custom App (TEP) support
indicates a Tizen-based custom content-player workflow. It does not establish
unsigned installation, arbitrary webpage playback, or access to every device API.

The owner cites the Samsung-branded [E-Paper Setup & Web API Guide mirror][setup-mirror]:

- **Custom Player:** select Custom, enter a Custom App URL, and select Install.
  The guide's example is `http://192.168.0.101:3000/app`.
- **Developer Mode:** enable the toggle, enter the development PC IP, restart the
  display, then connect/install through the Tizen SDK in debug mode.

This is model-specific evidence, unlike generic consumer-TV instructions. Treat SDK
installation as debug/temporary until persistence is tested. Custom Player appears
to be the intended installed path, but durable installation is not yet proven.
Do not assume USB `.wgt` installation, generic SDB procedures, URL Launcher, consumer-TV
Developer Mode steps, TV Seller Office deployment, or consumer app-store behavior.

### Custom Player package contract: incomplete

The supplied guide findings describe an installation base URL, not an arbitrary web
page. They identify `sssp_config.xml`, a mandatory `size` field, and a Tizen `.wgt`.
They also state that installation requires this E-Paper support metadata in the app:

```xml
<tizen:metadata
    key="http://samsung.com/tv/metadata/application/epaper.support"
    value="true"/>
```

Example only; this is not a verified server layout:

```text
/app/
  sssp_config.xml
  SomeApplication.wgt
```

Do not hard-code the package filename, full XML schema, placement of `size`, or
request sequence. The exact semantics of a URL ending in `/app` remain unknown.
Observe device traffic before building a full installer server.

### Signing and privileges are separate

Public Tizen and Samsung certificate tooling supports development signing workflows.
A registered company is not clearly required for a basic development app. Start with
normal Samsung/Tizen development certificates; success on this device remains a test.
Keep author/distributor certificates and keys outside Git.

Partner-level `systemcontrol` is different. The E-Paper hardware APIs cover sleep,
scheduled wake, network standby, refresh, battery, and LED controls. Plan on Samsung
partner signing/permission for these calls unless evidence establishes otherwise.
No public self-service hobbyist route has been identified. A business/partner
relationship, Samsung approval, an offline agreement, or local Samsung/Content Manager
involvement may be needed. Declaring the privilege does not grant it.

[Seller Office membership][membership] permits individual accounts in some contexts.
That does not establish a signage distribution path or grant Partner privileges.
Do not state that all custom-app development requires a registered business.
The first package must render basic HTML/JavaScript without `webapis.epaper.*` calls.

The owner also reports a public account from an EM32DX user who wrote a Tizen app to
pull and display personal data. No report URL was supplied. Treat it as corroboration
only, not proof of signing, privilege access, persistence, or certificate lifetime.

### Proposed protocol and lifecycle tests — not performed

With separate owner approval, use an isolated LAN HTTP server to log Custom Player
requests. Start with 404 responses if needed. A simple example is:

```sh
mkdir app
cd app
python3 -m http.server 3000
```

This serves the new directory as the HTTP root; it does not prove that `/app` is the
correct URL suffix. Use an empty directory, never a directory with keys or private
files. The default server log is only a first path/status check; add request-header
logging or an approved capture to obtain the full evidence below. Stop the server
and remove disposable fixtures after the test. Do not expose it to the Internet.

Record method, path, headers, request order, retries, redirects, query parameters,
User-Agent/device headers, and subsequent `.wgt` requests. Distinguish, for example,
`GET /sssp_config.xml` from `GET /app/sssp_config.xml`. Record exact model, firmware,
entered URL, server responses, and device messages. Redact secrets from retained logs.

After protocol discovery, build the smallest E-Paper-enabled package, sign it through
the normal development path, serve the metadata/package, and attempt Custom Player
installation. Record failures without substituting an unverified generic TV route.
Then test: running app → reboot → retained installation and automatic launch → power
removal/restoration → retained installation and automatic launch again. On this
battery device, unplugging external power alone is not a full power cycle; record
actual power state and use only an approved safe power-off procedure.

Also verify whether Developer Mode must stay enabled, certificate expiry affects
runtime, and operation needs ongoing Samsung cloud/partner access. A short test does
not prove indefinite operation. Test SDK debug deployment separately. Only after basic
operation succeeds should a separately authorized probe identify API failures caused
by Partner privileges. Keep unsupported APIs distinct from permission failures.

### Optional official-app network observation

With approval, capture at the Wi-Fi router/AP while changing exactly one image through
Samsung's app. Identify phone/display IPs, start capture, change the image, then stop.
Inspect direct LAN and cloud traffic: ports, DNS names, HTTP/WebSocket/TLS, payload
sizes, mDNS/SSDP discovery, and whether the phone sends image data to the display.
A separate approved test can block only the display's Internet access while preserving
LAN access, then repeat the upload. Restore rules afterward. Do not start with TLS
interception. Metadata can indicate local versus cloud-assisted control without
collecting decrypted content. This test changes an image and network policy; this
plan does not authorize either action.

## Earlier retrieved evidence

Official pages were retrieved on 2026-09-26, from 10:29 to 10:32 UTC.
The sources in this earlier evidence table are from Samsung. The new setup-guide
mirror above is Samsung-branded material hosted by a third party, not a Samsung-hosted
page. The developer pages showed no clear update date.
“Documented” means that the reference states the behavior. It does not mean that
this firmware or a physical display was tested.

| Topic | Documented evidence | Limit or required check |
| --- | --- | --- |
| Platform | [Signage Model Groups][models] maps EMDX, EMDXA, and EMDX_13 to `24SIGNAGE_BASIC`, Tizen 8.0, and TV Extension 8.0 or later. It lists 1 GB RAM and 8 GB storage. | Record the exact unit model and firmware. Do not assume all storage is available to the app. |
| App structure | [Creating Web Applications][create] describes HTML, JavaScript, CSS, and `config.xml` projects in Tizen Studio. | Use a small packaged app. The creation guide alone does not establish the EM32DX installation route. |
| Signing | [Creating Certificates][certificates] requires valid signatures, an author certificate, a distributor certificate, a selected privilege level, and the target DUID for device testing. | Verify normal development signing first. Partner access is required only for the privileged hardware calls, not assumed for basic rendering. Keep keys outside Git. |
| Distribution | [Signage Model Groups][models] says signage groups are not open in Seller Office. It directs developers to Samsung's Content Manager or Tech Sales Team. | This is a distribution constraint, not proof that local installation is impossible. Confirm the local install method separately. |
| Device install | [TV Device][device] describes Smart Hub Developer Mode and Tizen Studio Run/Debug. | These are generic TV steps, even with the Signage filter. Do not present the `12345` menu sequence as an EM32DX procedure. The owner now confirms Custom Player and Developer Mode in the E-Paper app; see the model-specific findings above. URL Launcher, generic SDB procedures, and USB app installation remain unverified. |
| Network | [Configuring Web Applications][config] says external network access is denied by default under WARP. [Downloading Data][download] gives an HTTP download example. | Configure the chosen server origin and applicable CSP rules. Test HTTP JSON access, cross-origin behavior, and Wi-Fi downloads on the display. No blanket cross-origin exception for the main app server. |
| Downloads | [Downloading Data][download] documents `tizen.DownloadRequest`, `tizen.download.start`, completion/failure callbacks, the `download` privilege, and a capability check. | Verify the capability and the chosen destination on EM32DX. Use the returned completion path; [Download API][download-api] says a filename can change on collision. |
| Local storage | [Managing File Operations][files] documents `filesystem.read`, `filesystem.write`, and `tizen.filesystem.resolve`. `wgt-private` is app-private storage. `wgt-package` is read-only. `wgt-private-tmp` is cleared on termination or runtime restart. | Candidate cache: `wgt-private`. Verify download-to-cache, image loading from its URI, restart recovery, and free-space handling. Uninstall removes private data. Do not use temporary storage or browser HTTP cache as durable storage. |
| E-paper controls | [Epaper API][epaper] defines `webapis.epaper`, since 8.0, for B2B e-paper products. Load `$WEBAPIS/webapis/webapis.js`. It requires Partner-level `http://developer.samsung.com/privilege/systemcontrol`. | Probe API presence and `getVersion()`. Handle `SecurityError` and `NotSupportedError` as feasibility failures, not ordinary network retries. |
| Refresh | [Epaper API][epaper] documents `screenRefreshNow()` as a screen refresh request. | It does not specify whether every DOM image change requires this call, pixel-capture timing, panel completion time, or a refresh-complete callback. Its return type is `void`. Test the actual panel before choosing the update sequence. |
| Sleep | [Epaper API][epaper] documents `setAutoSleepTime("OFF")`, sleep control, network standby, and scheduled wake. | Disabling auto-sleep is a candidate for a powered prototype. It is not a boot-launch or crash-recovery guarantee. Network standby is not a guarantee that JavaScript continues to run. |
| Boot and persistence | [Configuring Web Applications][config] explicitly says prelaunching is not supported for signage. [Quick-start Guide][quick] describes visibility changes and state storage. | Do not use TV prelaunch metadata as autostart. Verify the device's supported app launch setting, cold boot, sleep/wake, and unattended operation. A retained panel image does not prove the app is running. |
| Screensaver | [Setting Screensaver][screensaver] documents `webapis.appcommon.setScreenSaver`. | This is generic guidance. Do not equate disabling a TV screensaver with preventing e-paper sleep or forcing panel refresh. |
| Samples | [Signage Samples][samples] lists video, syncplay, document, system-control, and timer samples. | The retrieved list had no e-paper sample. These samples do not prove EM32DX refresh or lifecycle behavior. |

### API declaration candidates

Later probes may need these documented privileges if they use the APIs above.
Do not request Partner privileges in the first basic rendering package:

- `http://tizen.org/privilege/download`
- `http://tizen.org/privilege/filesystem.read`
- `http://tizen.org/privilege/filesystem.write`
- `http://developer.samsung.com/privilege/systemcontrol` — Partner level

The final `config.xml` must also have the target runtime's required network
permissions and external-access policy. Verify that configuration in the device
probe. Do not copy a broad TV manifest or request unrelated permissions.

### Refresh and timing limits

A successful `screenRefreshNow()` return is not proof that the panel has finished.
The physical probe must establish whether a decoded DOM image is sufficient, or
whether an explicit refresh is needed after rendering. Do not refresh on each poll.
Record visible transition duration and any ghosting.

For a first prototype, propose that `showAt` means “start the update at this time,”
not “all pixels are settled at this exact time.” This requires user agreement.

The wake API reference is internally unclear: its signature takes a calendar-time
object, but its description also discusses a delay of 1–604800 seconds. Do not build
battery scheduling around it without Samsung clarification and physical tests.

## Battery and LAN follow-up

The owner confirmed that the EM32DX shares the Raspberry Pi's LAN and will primarily
use battery power. At the first check, the owner reported power-saving mode.
The later powered check is recorded below. The plan requires battery wake feasibility
before a full player implementation; Regular mode is the first priority.

### Read-only LAN observation

Parent-run check at 2026-09-26 11:51:23 UTC:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 rasp 'printf "UTC "; date -u +%Y-%m-%dT%H:%M:%SZ; printf "LAN addresses\n"; ip -brief -4 address show dev wlan0; ip -brief -4 address show dev eth0; printf "LAN neighbours (cached, not a scan)\n"; ip -4 neigh show dev wlan0; ip -4 neigh show dev eth0'
```

SSH succeeded. `wlan0` was up at `192.168.68.126/24`. Its neighbour cache contained
five entries: three `STALE` and two `REACHABLE`. No supplied display IP or MAC was
available to identify an entry as the EM32DX. No LAN address was shown for `eth0`.

This was a cache read, not a network scan. It does not show that the display is online
or offline. No targeted display probe, wake packet, power change, or service change
was made. No temporary artifacts were created. This initial check could not identify
the display. The owner later supplied its IP; see the powered check below.

### Wake evidence and limits

At 2026-09-26 11:51 UTC, Python `requests` and BeautifulSoup retrieved [Epaper API][epaper]
and [RemotePower API][remotepower]. Both returned HTTP 200. The question was whether
network standby establishes remote wake from battery sleep. No clear page update
date was shown. No search backend, browser, or files were used; no retry was needed.

- `webapis.epaper.setScheduleWakeupTime()` is an on-device scheduling method. It is
  not a command the Pi can send to an already sleeping display over HTTP.
- `webapis.epaper.setNetworkStandby("ON")` sets network standby, but the reference
  does not specify a wake packet, port, protocol, battery cost, or which e-paper
  power-saving states remain reachable. Remote wake is still unverified.
- The RemotePower module heading mentions HTV and LFD. However, `powerOn()` is marked
  **HTV**, and virtual-standby controls explicitly target HTV models. Do not use this
  module as proof that an EM32DX can be remotely awakened.
- A scheduled wake configured before sleep is a possible alternative to remote wake.
  It needs a physical test of timer behavior, app launch, network reconnection, and
  battery use on this firmware. Partner-level access remains a prerequisite for the
  documented e-paper methods.
- A DHCP lease or cached neighbour entry is not proof of current communication.
  A ping response would prove IP reachability, not app readiness or remote wake.
  A failed ping would not rule out a separate supported wake mechanism.

Design consequence: if scheduled wake works but remote wake does not, use agreed
wake/check windows. New content cannot be discovered while both the network and app
are asleep. It can be fetched after the next wake. An earlier `showAt` cannot be
honored without prior prefetch or a working remote wake path. If neither wake method
works for the custom app, unattended battery operation is blocked.

## EM32DX manual check

The [Finnish support page][support] returned HTTP 200. It lists this English manual:

- `BN81-27642A-04_WUG_EM32DX EM32DX-A EM13DX_EU_ENG_260903.0.pdf`
- Version: `2609030`
- Listed update date: 2026-09-20
- [Direct manual download][manual]

The first PDF download returned HTTP 200, but no local PDF text tool was available.
The owner then added Pi Web PDF support. The manual's 37 pages were read through
`read_web_pdf`; the earlier content-review blocker is resolved.

Saved snapshot ID: `883abc3c-6164-4286-b239-ea18f9484889`.
SHA-256: `d571e03bb37f14f970c5561b624693861f894a36f88c1e9699475db6ffdb1dd3`.
After context compaction, reread that saved PDF before making new page-specific claims.
Saved IDs are branch-scoped. In a fresh session, use the direct manual URL below if
that saved ID is unavailable. The snapshot alone is not proof of a read; these findings
use its delivered contents.

| Manual page | Finding | Design consequence |
| --- | --- | --- |
| 13, 32, 36 | EM32DX/EM32DX-A panel specification is 2560 × 1440. USB picture guidance gives 1440 × 2560 and supports BMP, JPG, JPEG, PNG. | Confirm intended orientation and app viewport. Do not apply USB limits blindly to a custom web renderer. |
| 28 | The EM32DX-A-only note requires 2.4 GHz Wi-Fi for remote wake through the mobile app, VXT, or a custom app. | Evidence that remote wake is intended for that variant, not proof of a public Pi protocol or the non-A model's behavior. |
| 28 | The network section names Multiple Display Control, Log Downloader, DLNA, and SmartThings, subject to software updates. | A list of services is not proof of a usable image publishing or app installation endpoint. |
| 29, 37 | Image changes take time and can flicker. Automatic screen refresh is described. Page 29 says to allow about five minutes for stabilization. | Measure the actual update sequence. Do not turn five minutes into an invented hard minimum image interval or assume immediate physical completion. |
| 30 | Network Standby increases battery use and may exhaust the battery without showing its low-battery icon. Mobile/VXT use also increases consumption. | Regular mode should not rely on always-reachable standby without measurements. |
| 35 | Initial setup requires the Samsung E-Paper mobile app and a user-set PIN. Skipping setup leaves only USB content playback. | The owner can avoid its routine image UI without assuming it can be removed from all initial setup. No PIN guessing or reset as discovery. |
| 36 | Power and Energy Saving controls Network Standby, Sleep mode, Deep sleep mode, Sleep mode off, and Sleep After. | Record the exact setting for every wake test. The names alone do not establish app execution during sleep. |
| 36 | USB picture import deletes the prior internal picture files before copying new ones. | Do not use USB import as a harmless probe. It is also not documentation of custom-app installation. |

The manual does not give a complete custom-app installation, signing, or boot-launch
procedure. A firmware download on the support page is not an app installer.

## Powered device and mode-planning follow-up

Owner requirements: Regular mode has priority, with one daily image change and about
a week of scheduling or daily dynamic fetch. Party mode allows higher battery use
for more frequent changes. Show Manager should own routine image management.

### Targeted powered reachability

Parent-run command at 2026-09-27 07:39:38 UTC:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 rasp 'printf "UTC "; date -u +%Y-%m-%dT%H:%M:%SZ; printf "Targeted reachability, owner-supplied display IP\n"; ping -n -c 3 -W 2 192.168.68.125; printf "Target neighbour\n"; ip -4 neigh show to 192.168.68.125 dev wlan0'
```

The owner reported that the display was connected to external power. The supplied IP
returned all three ping replies, with no packet loss. Average round trip was 41.069 ms.
The neighbour entry was `00:7d:3b:72:f5:dc` on `wlan0` (`DELAY` at the final read).

Result: current IP communication from the Pi is proven for the owner-supplied target.
Model identity was not queried. No control service, app install, sleep, or wake was
tested. No files, listeners, services, images, or settings were changed. No cleanup
was needed. These results do not establish battery-mode reachability.

### Retailer identity limit

At 2026-09-27 07:39 UTC, static Python `requests` retrieval of the [owner's Proshop
listing][retailer] returned `403 Client Error: Forbidden`. The lookup question was
its manufacturer model code. The URL title says EM32DX, but the page contents were
not read. No access bypass, authenticated browser, or alternate endpoint was used.
No files were retained. This first lookup did not establish the model code.

The owner subsequently pasted the listing: model `LH32EMDIBGBXEN`, EAN
`8806095804323`, with Custom App (TEP) support and an up-to-24-hour battery claim.
These are owner-supplied retailer claims, not independently retrieved Proshop text.
The battery claim has no supplied operating conditions. It does not establish the
lifetime of daily scheduled battery operation.

At 2026-09-27 07:52:28 UTC, a parent-run Python `requests`/BeautifulSoup fetch of
[Samsung support for the ordered model][ordered-support] returned HTTP 200.
Its title is `32" Color E-Paper EMDX`. Its declaration-of-conformity download link
contains `ModelName=EM32DX`. This resolves the ordered code to the non-A EM32DX.
No clear page update date was shown. No retry, search backend, browser, or local
artifacts were needed. The physical unit's firmware was not queried remotely.
The owner later supplied `S-RSEDWWC-1061.0`, recorded under current device facts.

The initial support URL used `LH32EMDIAGBXEN`, the EM32DX-A code. Keep that source
as retrieval history for the shared manual, but use `LH32EMDIBGBXEN` for this unit.
The manual's A-only remote-wake note cannot establish either support or lack of
support on the ordered non-A model. Custom App (TEP) is a useful installation lead,
not proof of unrestricted signing or availability of Partner APIs.

The revised plan separates daily scheduled wake from on-demand Party activation.
Regular mode can succeed without remote wake if the app reliably wakes on schedule.
Party activation during deep sleep remains pending until a supported wake or the
next scheduled check. Do not show a requested mode as active without device evidence.

## Lookup record and limits

- Questions: EM32DX platform, app installation, privileges, boot launch, HTTP,
  persistent files, sleep, and physical e-paper refresh.
- Intended source type: official Samsung model and developer documentation.
- Tool: Python `requests` and BeautifulSoup, with available `lxml`.
- Search backend: unavailable; `ddgs` was not found. No search result claims are made.
- Selected pages: supplied URLs and relevant official links from those pages.
  All cited Samsung HTML pages and the manual download returned HTTP 200.
- The initial API and samples overview extraction omitted content outside `main`.
  Retrieval with `?device=signage` and wider static extraction found the API links
  and sample list. The dedicated Epaper reference was then read.
- Two uncited candidate URLs returned HTTP 404: the Finnish business product path
  `/fi/business/smart-signage/epaper/emdx-lh32emdiagbxen/` and developer guide path
  `/smarttv/develop/guides/fundamentals/security.html?device=signage`.
- The Tizen policy link from Samsung returned HTTP 403:
  `https://developer.tizen.org/development/training/web-application/application-development-process/setting-project-properties#policy`.
  Its contents were not used as evidence.
- No general search retry was possible because the command was absent. No packages,
  accounts, authentication, or browser sessions were added.
- Retrieval used memory only. There are no disposable lookup files to remove.
- The initial lookup did not test a physical device, LAN route, certificate, or app.
  The later read-only Pi LAN observation is recorded separately above.

[setup-mirror]: https://device.report/m/ba62b910d29f8f2b109ab1aacfb37a333cca80e595aa12944a9d1fc7eb41d531
[membership]: https://developer.samsung.com/tv-seller-office/guides/membership/becoming-seller-office-member.html
[ordered-support]: https://www.samsung.com/fi/support/model/LH32EMDIBGBXEN/
[retailer]: https://www.proshop.fi/Infonaeytoet-Digitaaliset-opasteet/Samsung-EM32DX-EMDX-series-315-e-Paper-display-QHD-247/3385739
[models]: https://developer.samsung.com/smarttv/develop/specifications/signage-model-groups.html?device=signage
[create]: https://developer.samsung.com/smarttv/develop/getting-started/creating-tv-applications.html
[certificates]: https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html?device=signage
[device]: https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html?device=signage
[config]: https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html?device=signage
[download]: https://developer.samsung.com/smarttv/develop/guides/data-handling/downloading-data.html?device=signage
[download-api]: https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/download-api.html?device=signage
[files]: https://developer.samsung.com/smarttv/develop/guides/data-handling/managing-file-operations.html?device=signage
[epaper]: https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/epaper-api.html?device=signage
[remotepower]: https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/remotepower-api.html?device=signage
[quick]: https://developer.samsung.com/smarttv/develop/getting-started/quick-start-guide.html?device=signage
[screensaver]: https://developer.samsung.com/smarttv/develop/guides/fundamentals/setting-screensaver.html?device=signage
[samples]: https://developer.samsung.com/smarttv/develop/samples/signage-samples.html?device=signage
[support]: https://www.samsung.com/fi/support/model/LH32EMDIAGBXEN/
[manual]: https://org.downloadcenter.samsung.com/downloadfile/ContentsFile.aspx?CDSite=UNI_FI&OriginYN=N&ModelType=N&ModelName=EM32DX-A&CttFileID=11740462&CDCttType=UM&VPath=UM%2F202609%2F20260920112532001%2FBN81-27642A-04_WUG_EM32DX+EM32DX-A+EM13DX_EU_ENG_260903.0.pdf
