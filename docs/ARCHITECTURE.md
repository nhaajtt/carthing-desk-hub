# Architecture

## Components

| Component | Where | What it does |
|---|---|---|
| **Kiosk** | Car Thing | Nocturne 4's Chromium 147 (`cast_shell`, single process) in kiosk mode, pointed at `http://10.42.1.6:8787/` through `/var/lib/hub/kiosk-env`. |
| **brightness-sync.sh** | Car Thing | Polls `GET /api/brightness` every 2 s. A new daytime level goes into Nocturne's `/var/lib/brightness.json` with `auto:false` and `nocturned` is restarted to load it; `0` (night) and waking up only write the backlight. Also puts the backlight back every 2 s, because `nocturned` sets it to 0 whenever it restarts (which happens each time Mei records). |
| **kiosk-watch.sh** | Car Thing | Every 15 s asks Chromium's DevTools (loopback) which page is open. If it is not the hub (for example an error page because the hub was down at boot) and the hub answers `/health`, restarts the kiosk. |
| **systemd watchdog** | Car Thing | `RuntimeWatchdogSec=30s` on the Amlogic hardware watchdog: a frozen system reboots itself. |
| **voice-agent.sh** | Car Thing | Long-polls `GET /api/voice/cmd`. On `record`: pauses `nocturned` (which holds the mics), runs `arecord` on `hw:0,0` (4 ch, S32_LE, 16 kHz), reports `/api/voice/started`, uploads the WAV on `stop`. Also runs `reboot` / `poweroff`. |
| **phonelink** | Car Thing | Go, static, about 8 MB of memory. Talks to BlueZ over D-Bus: pairs one iPhone (2-minute window, 6-digit code), reads its notifications (ANCS), what is playing (AMS) and battery, and serves the result to the kiosk page only, at `http://127.0.0.1:5055`. In the car it also reads an OBD-II reader. See *iPhone link* and *OBD reader* below. |
| **carthing-hub** | Server 2 (Docker) | Node 22, no dependencies. Collects every data source, keeps all keys, serves the UI and streams state over SSE. |
| **docker-status** | Server 2 and Server 1 | The only container with `docker.sock` (read-only mount). Answers `GET /` with container names, state and health. No host port. |
| **hub-stats-agent** | Server 1 (Docker) | Every 5 s pushes CPU, memory, disk, temperature, load, uptime and the container list to `POST /api/ingest`, plus the host report once a minute. No ports. |
| **host-report.sh** | Server 2 and Server 1 (cron, normal user) | Every 5 min writes failed SSH logins, UFW blocks, sockets open on every interface and pending apt updates to a JSON file (read-only mount into the hub / the agent). |
| **carthing-stats.sh** | Server 2 (cron, every 2 min) | Reads the Car Thing's CPU, memory, temperature, storage, uptime and whether the kiosk and helpers run, over SSH; writes `host-report/carthing-stats.json` for Servers → Now. Only reads on the device. |
| **check-carthing.sh** | Server 2 (by hand, and hourly from cron with `--json`) | Compares the Car Thing's helpers and `/etc` files with `carthing/`, checks the kiosk override, key, sshd and time sync, and puts back what a Nocturne update reset. |

## Data sources (all free, no paid keys)

| Data | Source | Refresh |
|---|---|---|
| Crypto | OKX public websocket (`tickers`), REST fallback after 30 s of silence, 15-min candles for sparklines | real time / 5 min |
| Gold, silver spot | gold-api.com | 30 s |
| Indices, futures, USD/VND interbank | Yahoo Finance `v8/finance/spark` (one request for every symbol, UA `Mozilla/5.0`) | 60 s |
| SJC and ring gold | PNJ (`giaban × 10,000` = VND per tael) | 5 min |
| FX (VND) | Vietcombank XML (max 1 request / 5 min) | 5 min 5 s |
| Weather, AQI | Open-Meteo forecast and air-quality APIs | 10 / 15 min |
| Rain in the next 2 h | Open-Meteo `minutely_15` (precipitation and probability) | 5 min |
| Headlines | Google News RSS (sections and `when:1d` searches), Hacker News Firebase API | 2 min |
| Story summaries | Google News link → publisher URL (`batchexecute`), article text, Gemini `flash-lite` | on tap, cached |
| Mei | Gemini (`gemini-flash-latest`, falling back to `flash-lite` on HTTP 429) with the dashboard snapshot, the open story and the last 10 minutes of conversation | on demand |
| Morning briefing | Same model, text only, from the dashboard snapshot | `BRIEFING_AT` (07:00) and button 1 on Mei's page |
| Calendar | Secret iCal links (`CALENDAR_ICS`), parsed and expanded on the hub | 5 min |
| Spotify | Web API, Authorization Code + PKCE | 4 s |
| Image updates | The image's registry (Docker Hub, ghcr.io, …): anonymous `HEAD` of the tag's manifest, compared with the digest the container was pulled by | 6 h |
| GitHub | REST API: newest repositories, latest Actions run each, open issues and pull requests (search). ETags, no token needed for public repositories | 10 min (5 with a token) |

## Hub internals

```
hub/server/
  index.mjs          config, state, every data source, HTTP + SSE, auth checks
  alerts.mjs         price alert engine (1-min samples, 26 h history, cooldowns), one-shot levels set on the Car Thing (state/levels.json)
  assistant.mjs      Mei: command channel to the Car Thing, audio processing, Gemini
  news.mjs           feeds, Google News link decoding, article reading, summaries
  calendar.mjs       iCal parsing, time zones, RRULE / EXDATE / RECURRENCE-ID expansion
  history.mjs        24 h of 10-minute averages per server, saved in state/history.json
  security.mjs       host reports, ports seen before, Car Thing check, security banners
  registry.mjs       newer-image checks against the registries
  github.mjs         CI runs, open issues and pull requests
  spotify.mjs        PKCE linking, polling, actions, album-art proxy
  covers.mjs         a picture for what the iPhone plays: YouTube thumbnail or iTunes cover
  lyrics.mjs         timed lyrics from LRCLIB, parsed from LRC; Vietnamese lines from Gemini Flash-Lite
  desk.mjs           minutes at the desk per day (state/desk.json), stand-up nudge
  reminders.mjs      reminders Mei sets (state/reminders.json): banner and screen on when due
  words.mjs          vocabulary cards: new words from Gemini Flash-Lite, Leitner reviews (state/words.json)
  net.mjs            internet latency and outages every 30 s, 24 h of 10-minute averages (state/net.json)
  docker-status.mjs  the read-only sidecar
```

* **State and push.** One `state` object. Any change calls `changed()`, which batches for 500 ms and sends the whole state to every SSE client. The state only holds what the screen draws (about 26 KB); article links and related headlines stay in a separate map on the hub.
* **Clock.** Every SSE message carries the hub's time; the UI uses `clockOffset` for the clock and for staleness checks (the Car Thing also gets NTP from the hub now).
* **Liveness and updates.** Besides state pushes, the hub sends a named `hb` event every 10 s (SSE comments never reach JavaScript, so they cannot tell a quiet hub from a dead link). After 25 s of silence the UI shows a "Reconnecting" card and opens a fresh `EventSource` every 30 s. Every message also carries `v`, an id that changes each time the hub starts; when the UI sees a new one it reloads, so new UI code reaches the Car Thing without touching it.
* **Calendar.** Times with a `TZID` are converted with `Intl` (offset checked twice so the hour around a DST change lands right). Recurring events are expanded in wall-clock time of their own zone, so a 10 am meeting stays at 10 am across DST. Daily and weekly series without `COUNT` start counting near the window instead of from their first year. `hub/test/calendar.test.mjs` covers these cases.
* **Two views of the state.** The Car Thing (and addresses in `PREVIEW_FULL_FROM`) get everything. Any other client, i.e. the LAN preview, gets the state without calendar events, security and update details, GitHub, Mei's answers and the security / CI banners.
* **Language.** English or Vietnamese is kept on the hub (`state.display.lang`, saved in `state/display.json`), not in the browser, because the hub writes text too: price, rain, security and CI banners, and Mei's briefing (unless `BRIEFING_LANG` pins one). The UI translates its own strings with `tr()`, and the fixed messages the hub sends (Mei's errors) by exact match. °C / °F is only a display choice, stored in the Car Thing's `localStorage`; the hub keeps sending its own unit.
* **Night.** Between `NIGHT_DIM`'s times the hub answers `0` to `GET /api/brightness`. Any input on the Car Thing calls `POST /api/display/wake`, which lights it for `WAKE_MINUTES`; the UI swallows that first input (and anything in the 2.5 s the backlight needs to come on) so a tap in the dark does not press anything.
* **Reminders.** Mei's answer can end with `R: <minutes> | <text>` when the user asked to be reminded; the hub keeps it in `state/reminders.json` (at most 20, up to a week ahead). When it is due, a banner shows on every page and the screen lights (night, or the phone away).
* **Time at the desk.** The Car Thing reports the iPhone's near / away and a heartbeat every 2 minutes; each minute while near (and heard from in the last 6 minutes) is added to today. A break of 3 minutes resets the sitting streak; at 60 minutes (`DESK_SIT_MINUTES`) a banner says to stand up.
* **Command channel.** `GET /api/voice/cmd` is a 25 s long-poll held open by `voice-agent.sh`. The hub answers it with `record <id> <seconds>`, `stop <id>`, `reboot` or `poweroff`.
* **Audio.** The WAV arrives as 4-channel 32-bit PCM. The hub averages the channels, resamples to 16 kHz, removes the DC offset, drops the first 150 ms, measures 50 ms windows (noise = 20th percentile, loud = 95th percentile), and only calls Gemini when loud ≥ 4 × noise and ≥ RMS 20. Gain is normalised up to 40×.

## UI internals

```
hub/public/
  index.html   pages: News, Markets, Weather, Calendar, Music, Servers, Focus, Mei; quick menu; offline card
  i18n.js      English / Vietnamese strings, tr() and the locale for dates
  app.js       rendering, controls, quick menu, orientation, News browse/summary, Markets zoom, Calendar
  stage.js     Mei & Nhat: actors, scene toolkit, 7 scenes
  torch.js     desk clock: a torch on a stone wall drawn as ASCII (fire automaton in JS, WebGL draws the characters)
  style.css    layout
  theme.css    "Mei's night market" look, motion, portrait layout
```

* **Page changes, measured.** `tools/trace.mjs per` traces one page change at a time and splits the main thread's time into style, layout, paint and script; `per N` lists every task over 8 ms. What it found in this round:
  * `.page.on { pointer-events: auto }`: pointer-events is inherited, so switching it restyled and laid out every element of both pages on each change. The current page now sits on top with `z-index` instead.
  * `.page:not(.on) *` (pause animations off screen) matched every element; it now names only the elements that loop.
  * `setHTML` merges new markup into what is there (text nodes and attributes that changed), instead of replacing a block whenever one number in it moved.
  * Meter fills are scaled, not resized. The iPhone list is a plain block, not a flex column.
  * On the Mali-G31 (one core), filled rounded squares and dashed lines were the expensive part of drawing a page as it slid in: letter badges are coloured text, dividers are solid hairlines.
  * Tried and dropped: CPU rasterization (worse), multi-process Chromium (no change), sliding a page in with its old content and refreshing it after the slide (worse: the refresh lands at the end of the slide).
* **Keys act on release.** The knob press, Back and the round button run on keyup, so that holding them for 0.6 s can do something else (play / pause, home, screen off). The test tools send keyup as well.
* **Pages stay laid out.** Every page is `display: flex`; the ones not on screen get `content-visibility: hidden`, which skips them but keeps their layout, so showing a page again is cheap. A few seconds after start-up each page is laid out once (`warmUp()`). `render()` draws only the current page; the others are drawn when they slide in.
* **The slide.** The old and new page move side by side with the Web Animations API (`translate3d`, 260 ms), fully opaque: nothing ever shows through, which is what looked like ghosting with the old cross-fade. The new page is drawn first and gets two frames off screen before both move; the gold tab pill starts with them. A new knob turn finishes the running slide at once. During a slide, updates from the hub are held and drawn when it ends, and the new page is drawn without price flashes or rolling digits.
* **No work on hidden pages.** Animations on pages that are not current are paused (Mei's SVG legs and tail run on the main thread, and any main-thread animation makes the compositor wait during a slide).
* **Cheap updates.** The hub pushes at most twice a second. Intl formatters are created once and reused (creating them was most of a Markets update). `setHTML` / `setText` / `setClass` only write when the value changed. Market rows have a fixed height and `contain: strict`, so a new price lays out its own row only. Price flashes are an opacity glow (`::before` / `::after`) animated on the GPU instead of the text colour.
* **Diff per child.** `setVal()` parses new row markup into a `<template>` and replaces only the child elements whose markup changed, so a new price does not rebuild the sparkline next to it.
* **Nothing loops in the background.** The sky is painted once (no drifting blobs or twinkling stars); rain is the only ambient animation and pauses during a slide. No `backdrop-filter` (the quick menu uses a solid dim). Progress bars grow with `scaleX`, not `width`. The only looping animations left are on Mei's page.
* **Measuring.** `tools/framemeter.js` logs frame gaps while turning through every page; `tools/trace.mjs` reads Chromium's own frame reporter (compositor side) and counts the animation frames that were shown or dropped.
* **Orientation.** Four steps of 90°. Portrait lays `#app` out at 480 × 800 and rotates it ±90° with `transform`; upside-down landscape is a plain `rotate(180deg)`. The choice is stored in the Car Thing's `localStorage`. Touch input arrives in screen coordinates, so swipes are mapped into the rotated layout, and upside down the preset buttons are swapped (4 ↔ 1, 3 ↔ 2) because they now sit along the bottom edge in reverse order.

## iPhone link (phonelink)

```
carthing/phonelink/
  main.go    state, the loopback HTTP + SSE server for the kiosk page, pidfile
  bluez.go   D-Bus: agent (pairing), advertisement, finding the paired phone, GATT helpers, main loop
  gatt.go    the media-remote service that makes iOS list the Car Thing in Settings
  ancs.go    notifications and calls (Apple Notification Center Service)
  ams.go     now playing, queue, shuffle / repeat, remote commands (Apple Media Service)
  rssi.go    signal strength of the link, and "at the desk" from it
  blow.go    microphone level for the desk clock's torch (only while asked)
  clap.go    tap control: groups of 2 or 3 short, sharp sounds from the same levels
  light.go   the light sensor: "dark" for the car's night colours
  cts.go     the iPhone's clock (Current Time Service) sets the Car Thing's when it is off
  www.go     serves the car copy of the page on 127.0.0.1:5056, and the hub's pack for the car under /pack/
  obd.go     the OBD reader: search, connect, the read loop, its own SSE stream, and -obd-demo
  elm.go     the ELM327 protocol: the command allow-list, answers, live-data formulas, fault codes
  elm_test.go  the protocol against a fake reader (go test)
```

* **Being found.** Since iOS 18, Settings → Bluetooth no longer lists accessories that only ask for notifications, but it lists remotes. So the Car Thing also offers a HID-over-GATT service with consumer keys only (play, next, volume…): no keyboard, so the iPhone keeps its on-screen keyboard. It never sends a key; its report map can only be read over a code-paired link.
* **Pairing.** `POST /pair` makes phonelink BlueZ's default agent with the `DisplayOnly` capability, turns `Pairable` on and advertises as discoverable for 2 minutes. The iPhone asks for the 6 digits shown on the screen (`DisplayPasskey`). Every agent call outside the window is refused, and "just works" pairing (no code) is always refused. The first phone that pairs in the window becomes the only one; its identity address is kept in `/var/lib/hub/phonelink.json`.
* **Advertising.** Only during the window (discoverable) or while the paired phone is away (not discoverable, so it can find its way back). Once it is connected the Car Thing stops advertising.
* **Reading.** After the link is encrypted the phone shows its services. ANCS: a new notification arrives on Notification Source; phonelink asks for app, title, subtitle and message on Control Point and collects the answer from Data Source. What was already on the phone at connect time is skipped, except a ringing call. AMS: phonelink subscribes to player (app, state, volume) and track (artist, album, title, duration); writes on Remote Command play, pause, skip and change volume.
* **Sharing ANCS with nocturned.** Nocturne's daemon reads the same service. BlueZ runs one write per characteristic at a time and turns the other away with "In Progress", so phonelink retries, and it ignores Data Source answers that do not start with its own request's header.
* **What the phone already has.** iOS lists its existing notifications once, when the first program subscribes; that is usually `nocturned`, a moment earlier. Values that arrive on the phone's characteristics before phonelink listens are kept and replayed when it subscribes, and when phonelink starts while the phone is already connected it drops the link once so the phone lists them again. The newest 30 are fetched (with their date) and marked `old`: they fill the iPhone page without banners.
* **At the desk.** BlueZ gives no signal strength for a connected device, so `rssi.go` asks the kernel's management socket (`HCI_CHANNEL_CONTROL`, read-only command "Get Connection Information") every 2 s. A moving average above `-near` (default −62 dBm) for 4 s means at the desk; below `-far` (−78 dBm) for 20 s, or a lost link, means away.
* **Keys.** The remote's report carries seven consumer keys; phonelink only ever sets Siri (voice command) and volume up (the Camera app's shutter) while a button is held, and play / pause and volume up / down for Find my iPhone, all on `POST /key`; a key lets go by itself after 10 s.
* **To the screen.** `GET /events` streams the whole state (paired, connected, name, battery, pairing, media, call, last 12 notifications) as SSE within 100 ms of a change. `POST /pair`, `/pair/cancel`, `/forget`, `/media`, `/call`, `/note/clear` and `/key` take small JSON bodies sent as plain text (a "simple" request, so no CORS preflight). Everything is in memory and cleared when the phone disconnects.
* **Find my iPhone.** An accessory cannot make the phone ring, so the iPhone page plays its music instead, with the remote's media keys like a headset: volume up to the top, then play (with nothing playing, iOS resumes the last app; AMS alone cannot start playback when no app holds it). After 30 s, or a second press, pause and the same number of steps back down.
* **Car mode.** There is no Wi-Fi and no Bluetooth networking on the Car Thing, so in the car it has no network at all. phonelink serves a copy of the page (`/var/lib/hub/www`, refreshed by `check-carthing.sh`) on `127.0.0.1:5056`; that page knows it is the car copy from its port and shows Weather, Calendar, Music, iPhone and Car, from phonelink and the pack alone. Switching: `kiosk-env` picks the hub if `/health` answers within a few seconds at start, else the car copy; the hub page moves to the car copy after a minute without hub messages, and the car copy checks `/health` every 15 s and goes back; `kiosk-watch.sh` restarts the kiosk if Chromium is stuck on its error page on the hub's address for a minute. `brightness-sync.sh` gives the screen back to Nocturne's automatic brightness (light sensor) after a minute without the hub. The time comes from the iPhone's Current Time Service when the clock is more than 5 s off.
* **The pack for the car.** `server/carpack.mjs` keeps, in `state/carpack`, the cover and lyrics (with the Vietnamese lines) of the last 300 songs the iPhone played at the desk, keyed by title and artist without case, plus `pack.json`: the whole 4-day hourly forecast, the next 8 days of calendar events, Mei's reminders, the city, units and time zone. `tools/sync-carpack.sh` (cron, every 5 min) sends only new or changed files over SSH and `pack.json` last. In the car the page reads `/pack/pack.json`, picks the current hour of the forecast for Weather, fills Calendar, takes covers and lyrics from `/pack/c` and `/pack/l`, and raises Mei's reminders itself.
* **Night and the drive.** `light.go` reads the TMD2772 light sensor every 2 s and sets `dark` after 10 s below 3 lux (light again above 12 lux). The car copy swaps its colour variables for warm, dim ones. It also counts the drive from the first car page after a 10-minute gap and suggests a break after 2 hours, then every 30 minutes.
* **Tap control.** In the same 40 ms loudness loop as blowing: a window more than 18 dB over the room (and above −40 dB) that started from quiet and lasts at most 120 ms is a tap; taps less than 700 ms apart make a group, and 800 ms of quiet ends it. 2 or 3 taps go to the page as `tap`; anything long and loud in the group cancels it. The log line `tap: N, peak X dB over a Y dB room` is there for tuning.
* **Covers.** The phone sends no pictures. The page borrows Spotify's art when the iPhone plays the same song Spotify reports, and otherwise asks the hub, which searches YouTube's public results page (for the YouTube app) or Apple's iTunes Search API (everything else) and proxies the image.

## OBD reader (car mode)

* **Who starts it.** Only the car copy of the page opens `GET /obd/events`. phonelink scans and connects only while some page listens, and 2 minutes after the last one left; at the desk the hub page never listens, so the Car Thing never scans there. The stream is separate from `/events` and sends at most 5 updates a second, so the iPhone state is not re-sent with every engine value.
* **Choosing.** `POST /obd/search`: 30 s of LE discovery (`SetDiscoveryFilter` transport `le`). A candidate needs a name that looks like a reader (`obdName`: OBD, ELM327, V-LINK, Vgate, iCar, Veepeak, Konnwei, OBDLink…) and a signal above −80 dBm; the strongest is saved to `/var/lib/hub/obd.json`. After connecting, it must answer `ATI` like an ELM327, or it is forgotten. `POST /obd/forget` disconnects, removes it from BlueZ and deletes the file.
* **Connecting.** BlueZ forgets unpaired LE devices soon after they disappear, so each session scans up to 15 s for the saved address, then `Connect`, waits for services, and finds the serial service: one of five known UART layouts (`FFF0`, `FFE0`, `18F0`, Vgate's `E7810A71…`, Nordic UART) or else any non-standard service with a notify and a write characteristic. Commands go out in 20-byte writes; notifications come back through the Bluetooth loop in `bluez.go` (`obdValue`), which hands them to the session's channel. Device signals for the reader are kept away from the phone logic (`isOBD`).
* **Reading.** `ATZ`, then echo, line feeds, spaces and headers off, adaptive timing, automatic protocol. `ATRV` (battery at the socket) works with the engine off, so the page shows the voltage while it waits. `0100`/`0120`/`0140` say which values the car has (the first one starts the protocol search, up to 20 s). Each round asks speed, revs, throttle and load, plus three of coolant, fuel level, air flow, fuel rate, intake, ambient, oil temperature, module voltage and run time in turn; the battery every 3 s; `0101` (check-engine light, number of codes) every 30 s, and `03` when there are codes. Three rounds without an answer mean the engine is off: the state goes back to `noecu` and the protocol search runs again every 10 s.
* **States** on the stream: `none` (no reader chosen), `search`, `wait` (looking for the saved reader), `connect`, `init`, `noecu` (reader on, car not answering: only the battery), `live`. Values are in metric units in `v`; the page converts to mph and °F with the Weather page's unit.
* **The page.** A rev counter of 57 SVG ticks (7 per 1,000 rpm, the last 1,000 red) whose `on` class changes only for the ticks that changed; the throttle as an inner arc (`stroke-dasharray` on a path of length 100); three bars as `scaleX` transforms. Trip distance, engine time and fuel (the engine's fuel rate, or air flow ÷ 14.7 for petrol) are integrated from the stream in the page and kept in its storage for the current drive. Banners on any page: coolant ≥ 112 °C, check-engine light, battery under 11.8 V with the engine off. Measured with the demo stream: 60 fps (p95 16.8 ms, 1 frame over 33 ms in 8 s), the CPU 83 % idle.

## Network

| Link | Addresses | Allowed |
|---|---|---|
| Car Thing ↔ Server 2 | USB CDC-NCM, `10.42.1.2` ↔ `10.42.1.6/29` | Car Thing → `10.42.1.6:8787/tcp` (hub) and `:123/udp` (NTP). Nothing else, no forwarding. |
| Server 1 → Server 2 | LAN | `POST /api/ingest` with token, accepted only from `10.10.10.21` |
| LAN → Server 2 | LAN | SSH, the hub's LAN preview (`10.10.10.20:8787`, read-only), admin UIs |
| Hub → Internet | outbound HTTPS | data sources above |
| iPhone ↔ Car Thing | Bluetooth LE, bonded with a 6-digit code (LE Secure Connections) | Notifications, media and battery from the phone; answer / decline and media commands to it. Only the paired phone; pairing is refused outside the 2-minute window. |
| OBD reader ↔ Car Thing | Bluetooth LE, no pairing (cheap readers have none) | Car Thing → reader: only the allow-listed ELM327 commands (`elm.go`). Reader → Car Thing: answers, size-capped and parsed as hex. Only the saved reader, only while the car page listens. |
| Kiosk page → phonelink | Car Thing loopback, `127.0.0.1:5055` | Only requests whose `Origin` is the hub page or its car copy (`http://127.0.0.1:5056`). |
| Kiosk → car copy of the page | Car Thing loopback, `127.0.0.1:5056` | Static files only (GET; html, js, css, woff2; under `/pack/` json and jpg). |
| Hub → whisper | internal Docker network `speech` | `POST /inference` with a clip. The whisper container has no other network. |
| Server 2 → Car Thing | USB, SSH with the hub key | `check-carthing.sh` (hourly, read-only checks; fixes only when run by hand), `carthing-stats.sh` (every 2 min, read-only), `sync-carpack.sh` (every 5 min, writes only `/var/lib/hub/pack`) |

`net.ipv4.ip_nonlocal_bind=1` lets Docker publish `10.42.1.6:8787` before the Car Thing is plugged in.

## HTTP endpoints

| Endpoint | Who may call it |
|---|---|
| `GET /`, `/events`, `/api/state`, static files | anyone who can reach the port (read-only); everyone but the Car Thing gets the trimmed state |
| `GET /api/brightness` | anyone (read-only) |
| `POST /api/brightness`, `/api/display/wake`, `/api/display/lang`, `/api/voice/*` (start, stop, briefing, dismiss, and the recorder's channel), `/api/device/*`, `/api/spotify/{toggle,pause,play,next,prev,volume,like}` | Car Thing only (`10.42.1.2`) |
| `POST /api/ingest` | `INGEST_FROM` address **and** bearer token |
| `GET /spotify/link` | not the Car Thing |
| `GET /callback` | valid one-time `state` (≤ 10 min old) |
| `GET /api/news/detail?id=` | anyone who can reach the port |
| `GET /api/spotify/art?u=` | proxies `https://i.scdn.co/` only |
| `GET /api/media/cover?app=&t=&a=&al=` | Car Thing only; fetches from `i.ytimg.com` or `*.mzstatic.com` only |
| `GET /api/media/lyrics?t=&a=&al=&d=` | Car Thing only; asks `lrclib.net` |
| `GET /api/media/lyrics/vi?…` | Car Thing only; the same lyrics translated by Gemini Flash-Lite, one request per song |
| `POST /api/alerts/level {asset, kind, value}` | Car Thing only; `kind` is above, below or clear |
| `POST /api/words/grade {id, known}`, `POST /api/words/more` | Car Thing only |
| `POST /api/desk {near}` | Car Thing only; presence reports and a 2-minute heartbeat |
| `POST /api/phone/summary {notes, calls, battery}` | Car Thing only; counts for the morning briefing, kept 2 h in memory |
| `POST /api/display/away` | Car Thing only; `true` makes `/api/brightness` answer 0 until `false` |
