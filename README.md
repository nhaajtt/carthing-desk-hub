<div align="center">

# Car Thing Desk Hub

**A bricked Spotify Car Thing, reborn as a desk companion:** live markets, news, weather, your calendar, Spotify, server health and security, a focus timer, and **Mei**, a little yellow cat you can talk to.

<img src="docs/screenshots/tour.gif" width="720" alt="A tour of the pages on the Car Thing: news and a story summary, markets, weather, calendar, music, servers, focus, Mei">

<sub>Recorded from the real device (800 × 480) over DevTools, not a mock-up. Every screenshot below is from the device too.</sub>

[Features](#features) · [Gallery](#gallery) · [How it works](#how-it-works) · [Setup](docs/SETUP.md) · [Dev log (Tiếng Việt)](docs/DEVLOG.md) · [Security](docs/SECURITY.md)

</div>

---

Spotify switched the Car Thing off in December 2024. Under the hood it is still a capable little Linux box: a 4" touchscreen, a big clicky knob, four preset buttons, a back button, four microphones, and USB. This project keeps the community firmware ([Nocturne](https://github.com/usenocturne/nocturne)) as the operating system, and replaces what the screen shows with a dashboard served from a small home server over the USB cable.

The Car Thing never touches the internet. It only talks to the hub, the hub only talks to free public APIs, and the network is locked so the device can reach exactly one port.

## Features

| | |
|---|---|
| 📰 **News** | Top stories, Việt Nam, Kinh doanh VN, Tech and Hacker News, refreshed every 2 minutes from Google News RSS and the Hacker News API. Tap a headline, or select it with the knob, for a one-paragraph summary of the actual article, in Vietnamese or English. |
| 📈 **Markets** | BTC with a rolling odometer price and a 24 h chart; ETH, SOL, BNB, XRP and DOGE streamed in real time over the OKX websocket; gold and silver; SJC and 9999 ring gold in VND; Vietcombank FX; VN-Index, S&P 500, Nasdaq, DXY and oil. Price alerts pop up on any page; in a zoomed view, press the knob and turn it to set a one-time alert level right on the Car Thing. |
| 🐈 **Mei** | Press the knob and talk. The four microphones record, the hub asks Gemini, and Mei answers in English or Vietnamese in a speech bubble. She remembers the last few minutes, so follow-ups work, knows which story you had open ("what does this one say?"), and **sets reminders** ("remind me in 10 minutes to call mum"): when one is due, a banner shows and the screen lights up. Every morning at 7 she writes a short **briefing**: weather, today's calendar, BTC and gold, USD/VND, top headlines, and how many notifications and missed calls the iPhone got overnight. While idle, Mei and her owner **Nhat** act out random little scenes. |
| 🌤 **Weather** | Current conditions, AQI, 12-hour and 4-day forecast (Open-Meteo), and rain in the next two hours in 15-minute steps, with a banner about half an hour before it starts. The sky behind every page takes the colour of the real weather. |
| 📅 **Calendar** | Your Google Calendar through its secret iCal link (read-only, no OAuth): what's next with a countdown, then today, tomorrow or the week. Recurring events, exceptions and daylight-saving changes are handled on the hub. A banner pops up 10 minutes before each event, on any page. |
| 🎵 **Music** | Spotify now playing and controls (PKCE, no client secret), album art proxied through the hub. When the paired iPhone is connected, whatever any app on it plays (Apple Music, YouTube, a podcast) comes first, with the same buttons plus shuffle and repeat; the hub looks up a cover or the video's thumbnail. The page takes its colours from the cover, and after a few quiet seconds it turns into a large cover with **lyrics that follow the song** (LRCLIB), with a Vietnamese line under each line of a foreign song when the screen is in Vietnamese. |
| 📱 **iPhone** | Paired over Bluetooth Low Energy, with nothing installed on the phone. Battery in the top bar (with low and full banners), new notifications as a short banner, incoming calls full screen (knob answers, Back declines; Spotify playing elsewhere pauses for the call). An **iPhone page** lists the phone's notifications, clears one on the phone itself, hides message text on request, holds Siri on button 1, takes a photo on button 2, starts a Siri reply on button 4, and **finds the phone** by playing its music loudly for 30 s. The Car Thing knows when you sit down: the screen switches off when the phone leaves the desk and greets you with a **while you were away** card when it comes back. Pair from the quick menu with a 6-digit code. Notification text never leaves the Car Thing. |
| 🖥 **Servers** | Four views on buttons 1–4. **Now**: CPU, memory, disk, temperature, uptime and container health for two home servers, the Car Thing's own CPU, memory, storage, temperature, uptime, Bluetooth link and helpers, and the internet line (latency every 30 s, a 24 h graph, banners when it drops or crawls). **24 h**: CPU, memory and temperature graphs. **Security**: failed SSH logins, what the firewall blocked, every port open on all interfaces (a new one raises a banner), and whether the Car Thing still has its setup. **Updates**: pending apt packages, containers with a newer image, and GitHub (latest CI run per repository, open pull requests and issues). |
| 📚 **Words** | A few new English words a day with IPA, a Vietnamese meaning and an example (Gemini Flash-Lite), reviewed on a Leitner schedule: press the knob to flip, 1 if you knew it, 2 if not. |
| 🕰 **Desk clock** | After 10 quiet minutes, or straight away from the Clock tile in the quick menu, the screen becomes ASCII art: a torch burning on a stone wall in the dark, its flickering light on the bricks, sparks rising, and the clock's digits catching fire when the minute changes. Turning the knob feeds the fire or lets it die down. The date, weather, next event and phone battery sit underneath as terminal text. |
| ⏱ **Focus** | A Pomodoro timer: buttons 1–4 set 15, 25, 45 or 60 minutes. Below it, **time at the desk** today and over the week, counted from the iPhone's presence, with a nudge to stand up after an hour without a break. |
| ⚙️ **Quick menu** | The round button opens screen brightness, restart, shut down, rotate (each press turns the screen another 90°), language, iPhone (pair, or forget the paired one) and the desk clock. |
| 🇻🇳 **English / Tiếng Việt** | The language tile switches the whole screen: pages, hints, dates and the clock, the banners the hub raises, and Mei's morning briefing. |
| 🌙 **Screen off** | Hold the round button to switch the screen off; touch anything to bring it back (that first touch only wakes it). An automatic night window (`NIGHT_DIM`) is available but off by default. |
| 🔌 **Self-healing** | If the hub goes quiet the screen says so and keeps reconnecting, and it reloads itself when the hub comes back with new code. A watcher on the device restarts the kiosk if it got stuck on an error page, and the hardware watchdog reboots it if it ever freezes. |

### Controls

| Control | What it does |
|---|---|
| **Knob (turn)** | Change page; inside a mode it moves through that mode instead |
| **Knob (press)** = Enter | The page's main action: pick stories on News, talk to Mei, volume on Music, start the timer on Focus |
| **Back** (button beside the knob) | Leave whatever you entered: a story summary, story selection, a zoomed market view, volume mode, Mei's answer |
| **Buttons 1–4** | Depend on the page; small numbered badges on screen show what each one does |
| **Round button** | Quick menu |
| **Hold the knob** | Play / pause music from any page |
| **Hold Back** | Home (News) |
| **Hold the round button** | Screen off; touch anything to bring it back |
| **During a call** | Knob press answers, Back declines; nothing else reacts until the call is over |

| Page | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| News | Next topic | Previous topic | | |
| Markets (zoom) | BTC | Gold | FX | Indices |
| Weather | °C / °F | | | |
| Calendar | Today | Tomorrow | Week | |
| Music | Previous | Play / pause | Next | Like |
| Servers | Now | 24 h | Security | Updates |
| Focus | 15 min | 25 min | 45 min | 60 min |
| iPhone | Siri (hold) | Camera shutter | Hide / show messages | Reply with Siri |
| Words | Knew it | Not yet | 5 more words | |
| Mei | Today's briefing | | | |

Upside down, the preset buttons sit along the bottom edge in reverse order, so the hub swaps them: the one on your left is always 1.

On **News**: press the knob to highlight a story, turn to move, press again (or just tap the story) for its summary. While a summary is open, turning the knob flips to the next story. Turn to Mei (the last page) with the summary still open and ask her about it.

## Gallery

| | |
|---|---|
| <img src="docs/screenshots/01-news.png" width="400"><br>**News**, five topics, buttons 1 and 2 to switch | <img src="docs/screenshots/16-news-summary.png" width="400"><br>**Story summary** (tap a headline) |
| <img src="docs/screenshots/15-news-browse.png" width="400"><br>**Picking a story** with the knob | <img src="docs/screenshots/03-markets-btc.png" width="400"><br>**Markets → BTC** (button 1) |
| <img src="docs/screenshots/04-markets-gold.png" width="400"><br>**Markets → Gold** (button 2) | <img src="docs/screenshots/05-markets-fx.png" width="400"><br>**Markets → FX** (button 3) |
| <img src="docs/screenshots/09-mei-answer.png" width="400"><br>**Mei answering** a spoken question | <img src="docs/screenshots/08-mei-nhat-1.png" width="400"><br>**Mei and Nhat**: the fish sandwich heist |
| <img src="docs/screenshots/17-calendar.png" width="400"><br>**Calendar** (sample events) | <img src="docs/screenshots/19-mei-briefing.png" width="400"><br>**Mei's morning briefing** |
| <img src="docs/screenshots/10-weather.png" width="400"><br>**Weather** | <img src="docs/screenshots/12-servers.png" width="400"><br>**Servers** |
| <img src="docs/screenshots/11-music.png" width="400"><br>**Music** | <img src="docs/screenshots/14-quick-menu.png" width="400"><br>**Quick menu** (round button) |

<details>
<summary><b>Portrait mode</b> (rotate from the quick menu)</summary>
<br>
<p align="center">
<img src="docs/screenshots/20-portrait-news.png" width="210">
<img src="docs/screenshots/21-portrait-markets.png" width="210">
<img src="docs/screenshots/22-portrait-mei.png" width="210">
<img src="docs/screenshots/23-portrait-weather.png" width="210">
<img src="docs/screenshots/24-portrait-calendar.png" width="210">
</p>
</details>

<details>
<summary><b>More</b>: indices zoom, calendar week, focus timer, more of Mei and Nhat</summary>
<br>
<p align="center">
<img src="docs/screenshots/06-markets-indices.png" width="400">
<img src="docs/screenshots/18-calendar-week.png" width="400">
<img src="docs/screenshots/13-focus.png" width="400">
<img src="docs/screenshots/08-mei-nhat-2.png" width="400">
<img src="docs/screenshots/08-mei-nhat-3.png" width="400">
<img src="docs/screenshots/08-mei-nhat-4.png" width="400">
<img src="docs/screenshots/07-mei.png" width="400">
</p>
</details>

## How it works

```mermaid
flowchart LR
  subgraph desk["On the desk"]
    CT["Car Thing<br/>Nocturne 4 · Chromium 147 kiosk<br/>knob · 5 buttons · 4 mics"]
    IP["iPhone<br/>notifications · media · battery"]
    IP <-- "Bluetooth LE<br/>paired with a code, encrypted" --> CT
  end
  subgraph s2["Server 2 (the brain)"]
    HUB["carthing-hub<br/>Node 22, read-only container"]
    DS2["docker-status<br/>read-only sidecar"]
    HR2["host-report.sh · check-carthing.sh<br/>cron, no root"]
    FW["UFW + DOCKER-USER<br/>USB: only :8787 and NTP"]
  end
  subgraph s1["Server 1"]
    AG["hub-stats-agent<br/>push only, no ports"]
    DS1["docker-status sidecar"]
    HR1["host-report.sh<br/>cron, no root"]
  end
  NET(("Free APIs<br/>OKX · Yahoo · gold-api · PNJ<br/>Vietcombank · Open-Meteo<br/>Google News · HN · Gemini<br/>Spotify · Google Calendar (iCal)<br/>GitHub · image registries"))

  CT <-- "USB CDC-NCM<br/>10.42.1.0/29" --> FW --> HUB
  DS2 --> HUB
  HR2 -- "read-only file" --> HUB
  HR1 --> AG
  DS1 --> AG -- "token + source IP<br/>POST /api/ingest" --> HUB
  HUB -- "outbound HTTPS only" --> NET
```

* **The Car Thing is a screen, not a computer you trust.** It runs Chromium in kiosk mode pointed at the hub, plus three tiny shell helpers (one applies the brightness you pick and switches the backlight off at night, one records the microphones when you talk to Mei, one reloads the kiosk if it gets stuck) and `phonelink`, a small Go program that talks to the paired iPhone over Bluetooth and serves only the kiosk page, on loopback. It has no route to the LAN or the internet. After a Nocturne update, `check-carthing.sh` on server 2 checks all of that and puts back whatever the update reset.
* **Security data without new privileges.** A small cron script on each server (run as the normal user, which can read the journal) writes failed SSH logins, firewall blocks, open ports and pending updates to a JSON file. The hub reads server 2's file through a read-only mount; server 1's agent sends its file along with the stats. Image update checks are anonymous `HEAD` requests to the registries.
* **The hub is the brain.** One Node.js process with no dependencies gathers every data source, keeps all keys, and streams state to the screen over Server-Sent Events. It runs in a read-only container with every capability dropped and no `docker.sock`.
* **Everything is free.** No paid API is required. The two optional extras that would cost money (Google Search grounding for Mei, and paid Gemini tiers) are off by default. When the main Gemini model runs out of its free daily quota, Mei switches to Flash-Lite on her own.

More detail: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · the whole story of how it was built, what broke, and why each decision was made: **[docs/DEVLOG.md](docs/DEVLOG.md)** (Vietnamese).

## Repository layout

```
hub/            the brain: Node 22 server, UI, config, compose file
  server/       index.mjs (data sources, HTTP/SSE), assistant.mjs (Mei), news.mjs, calendar.mjs,
                spotify.mjs, covers.mjs, lyrics.mjs, desk.mjs, reminders.mjs, words.mjs, net.mjs, alerts.mjs, history.mjs, security.mjs, registry.mjs, github.mjs,
                docker-status.mjs
  test/         node:test suite (calendar recurrence and time zones, image references, host reports)
  public/       index.html, app.js (pages + controls), stage.js (Mei & Nhat),
                style.css + theme.css, fonts/ (Bricolage Grotesque, OFL)
agent/          server-1 stats agent (push only) + its compose file
carthing/       files that live on the Car Thing: helpers, kiosk override and watcher, sshd, NTP, watchdog;
  phonelink/    the iPhone link over Bluetooth (Go, built on the brain by tools/build-phonelink.sh)
host/           server-2 host config: netplan, UFW / DOCKER-USER rules, sysctl, chrony; host-report.sh (cron)
tools/          setup scripts for secrets, check-carthing.sh (run after Nocturne updates), DevTools helpers (screenshots, the GIF, error capture)
docs/           SETUP, ARCHITECTURE, SECURITY, DEVLOG, screenshots
```

## Getting started

See **[docs/SETUP.md](docs/SETUP.md)**. In short: flash Nocturne 4 onto the Car Thing, plug it into a Linux box running Docker, apply the host network and firewall config, copy `hub/.env.example` to `hub/.env`, `docker compose up -d`, and point the kiosk at the hub.

## Credits

* [Nocturne](https://github.com/usenocturne/nocturne): the firmware that makes the Car Thing usable again. This project runs on top of it and only replaces the page the kiosk shows.
* [flashthing](https://github.com/JoeyEamigh/flashthing): flashing tool.
* Data: [OKX](https://www.okx.com/docs-v5/), Yahoo Finance, [gold-api.com](https://gold-api.com), PNJ, Vietcombank, [Open-Meteo](https://open-meteo.com), Google News RSS, [Hacker News API](https://github.com/HackerNews/API), [Gemini API](https://ai.google.dev), [Spotify Web API](https://developer.spotify.com), [GitHub REST API](https://docs.github.com/rest).
* Typeface: [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) (SIL Open Font License, see `hub/public/fonts/OFL.txt`).

This is a personal project and is not affiliated with Spotify, Nocturne, or any data provider. Respect each provider's terms; some of the endpoints used here are unofficial.

## License

[MIT](LICENSE)
