# Architecture

## Components

| Component | Where | What it does |
|---|---|---|
| **Kiosk** | Car Thing | Nocturne 4's Chromium 147 (`cast_shell`, single process) in kiosk mode, pointed at `http://10.42.1.6:8787/` through `/var/lib/hub/kiosk-env`. |
| **brightness-sync.sh** | Car Thing | Polls `GET /api/brightness` every 2 s, writes Nocturne's `/var/lib/brightness.json` with `auto:false`, restarts `nocturned`, writes the backlight. |
| **voice-agent.sh** | Car Thing | Long-polls `GET /api/voice/cmd`. On `record`: pauses `nocturned` (which holds the mics), runs `arecord` on `hw:0,0` (4 ch, S32_LE, 16 kHz), reports `/api/voice/started`, uploads the WAV on `stop`. Also runs `reboot` / `poweroff`. |
| **carthing-hub** | Server 2 (Docker) | Node 22, no dependencies. Collects every data source, keeps all keys, serves the UI and streams state over SSE. |
| **docker-status** | Server 2 and Server 1 | The only container with `docker.sock` (read-only mount). Answers `GET /` with container names, state and health. No host port. |
| **hub-stats-agent** | Server 1 (Docker) | Every 5 s pushes CPU, memory, disk, temperature, load, uptime and the container list to `POST /api/ingest`. No ports. |

## Data sources (all free, no paid keys)

| Data | Source | Refresh |
|---|---|---|
| Crypto | OKX public websocket (`tickers`), REST fallback after 30 s of silence, 15-min candles for sparklines | real time / 5 min |
| Gold, silver spot | gold-api.com | 30 s |
| Indices, futures, USD/VND interbank | Yahoo Finance `v8/finance/spark` (one request for every symbol, UA `Mozilla/5.0`) | 60 s |
| SJC and ring gold | PNJ (`giaban × 10,000` = VND per tael) | 5 min |
| FX (VND) | Vietcombank XML (max 1 request / 5 min) | 5 min 5 s |
| Weather, AQI | Open-Meteo forecast and air-quality APIs | 10 / 15 min |
| Headlines | Google News RSS (sections and `when:1d` searches), Hacker News Firebase API | 2 min |
| Story summaries | Google News link → publisher URL (`batchexecute`), article text, Gemini `flash-lite` | on tap, cached |
| Mei | Gemini (`gemini-flash-latest`) with the dashboard snapshot as context | on demand |
| Spotify | Web API, Authorization Code + PKCE | 4 s |

## Hub internals

```
hub/server/
  index.mjs          config, state, every data source, HTTP + SSE, auth checks
  alerts.mjs         price alert engine (1-min samples, 26 h history, cooldowns)
  assistant.mjs      Mei: command channel to the Car Thing, audio processing, Gemini
  news.mjs           feeds, Google News link decoding, article reading, summaries
  spotify.mjs        PKCE linking, polling, actions, album-art proxy
  docker-status.mjs  the read-only sidecar
```

* **State and push.** One `state` object. Any change calls `changed()`, which batches for 250 ms and sends the whole state to every SSE client. The state only holds what the screen draws (about 26 KB); article links and related headlines stay in a separate map on the hub.
* **Clock.** Every SSE message carries the hub's time; the UI uses `clockOffset` for the clock and for staleness checks (the Car Thing also gets NTP from the hub now).
* **Command channel.** `GET /api/voice/cmd` is a 25 s long-poll held open by `voice-agent.sh`. The hub answers it with `record <id> <seconds>`, `stop <id>`, `reboot` or `poweroff`.
* **Audio.** The WAV arrives as 4-channel 32-bit PCM. The hub averages the channels, resamples to 16 kHz, removes the DC offset, drops the first 150 ms, measures 50 ms windows (noise = 20th percentile, loud = 95th percentile), and only calls Gemini when loud ≥ 4 × noise and ≥ RMS 20. Gain is normalised up to 40×.

## UI internals

```
hub/public/
  index.html   pages: News, Markets, Mei, Weather, Music, Servers, Focus; quick menu
  app.js       rendering, controls, quick menu, orientation, News browse/summary, Markets zoom
  stage.js     Mei & Nhat: actors, scene toolkit, 7 scenes
  style.css    layout
  theme.css    "Mei's night market" look, motion, portrait layout
```

* **Render only what is visible.** `render()` draws the current page; other pages render when opened.
* **Diff per child.** `setVal()` parses new row markup into a `<template>` and replaces only the child elements whose markup changed, so a new price does not rebuild the sparkline next to it.
* **GPU only.** Every looping animation uses `transform` / `opacity` with `will-change`; effects that force repaints (`text-shadow` flashes, `filter` glows, shimmer inside `overflow:hidden`) were removed.
* **Portrait.** `#app` is laid out at 480 × 800 and rotated ±90° with `transform`; the orientation is stored in the Car Thing's `localStorage`.

## Network

| Link | Addresses | Allowed |
|---|---|---|
| Car Thing ↔ Server 2 | USB CDC-NCM, `10.42.1.2` ↔ `10.42.1.6/29` | Car Thing → `10.42.1.6:8787/tcp` (hub) and `:123/udp` (NTP). Nothing else, no forwarding. |
| Server 1 → Server 2 | LAN | `POST /api/ingest` with token, accepted only from `10.10.10.21` |
| LAN → Server 2 | LAN | SSH, the hub's LAN preview (`10.10.10.20:8787`, read-only), admin UIs |
| Hub → Internet | outbound HTTPS | data sources above |

`net.ipv4.ip_nonlocal_bind=1` lets Docker publish `10.42.1.6:8787` before the Car Thing is plugged in.

## HTTP endpoints

| Endpoint | Who may call it |
|---|---|
| `GET /`, `/events`, `/api/state`, static files | anyone who can reach the port (read-only) |
| `GET /api/brightness` | anyone (read-only) |
| `POST /api/brightness`, `/api/voice/*`, `/api/device/*`, `/api/spotify/{toggle,next,prev,volume,like}` | Car Thing only (`10.42.1.2`) |
| `POST /api/ingest` | `INGEST_FROM` address **and** bearer token |
| `GET /spotify/link` | not the Car Thing |
| `GET /callback` | valid one-time `state` (≤ 10 min old) |
| `GET /api/news/detail?id=` | anyone who can reach the port |
| `GET /api/spotify/art?u=` | proxies `https://i.scdn.co/` only |
