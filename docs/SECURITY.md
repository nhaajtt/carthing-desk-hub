# Security model

The rule for the whole project: **trust nothing by default, give everything the least it needs, and say exactly what can reach what.**

## Threat model

The Car Thing is treated as **untrusted**:

* Nocturne's root password is public (`nocturne`) and SSH is on by default.
* Chromium runs with `--no-sandbox`, so a renderer bug is a root shell.
* The screen shows text and images that come from the internet (headlines, album art).
* It is a portable device that can be lost or plugged in by someone else.
* Its Bluetooth radio can be reached by any phone or laptop in the room.

So the Car Thing must not hold secrets, must not reach anything except the hub, and the hub must not trust what the Car Thing sends beyond a short list of actions.

## Controls

| Layer | Control |
|---|---|
| **Car Thing → network** | Point-to-point USB link. UFW `DOCKER-USER` rules on the brain's USB interface allow only the hub port; NTP is the only other allowed packet. No forwarding to the LAN or the internet. |
| **Car Thing → brain config** | The brain takes a static address on the USB link and accepts no routes, DNS or IPv6 from the device (`accept-ra: false`, `link-local: []`). |
| **Car Thing access** | Root SSH by key only, from the brain only (`PasswordAuthentication no`, `PermitEmptyPasswords no`). |
| **Secrets** | Gemini key, Spotify refresh token, the ingest token and the secret iCal links live only in the hub's `.env` / `state/` (mode 600). The Car Thing never sees them. Spotify uses PKCE, so there is no client secret at all. The iCal links are never logged (errors name the calendar by number) and are entered through a script that masks them, so they stay out of shell history. |
| **Hub container** | `read_only`, `cap_drop: ALL`, `no-new-privileges`, non-root user, memory and PID limits, no `docker.sock`. |
| **Docker visibility** | Only the `docker-status` sidecar mounts `docker.sock` (read-only), answers a single `GET /` with names and states, and has no host port. |
| **Actions** | State-changing endpoints (brightness, Mei, Spotify controls, reboot / power off) accept requests only from the Car Thing's address. |
| **Server-1 agent** | Push only, no listening ports. The hub requires both the source address and a bearer token (constant-time comparison). |
| **Spotify linking** | One-time `state`, 10-minute expiry, never started from the Car Thing; the callback stays on loopback through an SSH tunnel. |
| **Album art proxy** | Only `https://i.scdn.co/`; covers for the iPhone only from `i.ytimg.com` and `*.mzstatic.com`, and only for the Car Thing. |
| **Bluetooth** | One phone. Pairing only in a 2-minute window opened from the quick menu, only with the 6-digit code shown on the screen (no "just works"). Classic Bluetooth stays off (not discoverable, not connectable); the Car Thing advertises only during that window or while the paired phone is away. phonelink offers no service another device could use. The remote service sends media keys to the paired phone only from the iPhone page: Siri and volume up (camera shutter) while a button is held, and play / pause and volume for Find my iPhone. Every key is released after 10 s at most, and there is no keyboard. Signal strength comes from the kernel's Bluetooth management socket, on which phonelink sends only the read-only "Get Connection Information" command. |
| **Away** | `POST /api/display/away` (Car Thing only) can only switch the screen off; any touch or the phone coming back switches it on. |
| **iPhone data** | phonelink listens on `127.0.0.1` only and answers only the hub page (`Origin` check). Notifications, calls and what is playing stay in its memory on the Car Thing: not written to disk, not logged, not sent to the hub, so never on the LAN preview. |
| **Microphone (desk clock)** | Only while the torch on the desk clock is out (at most 5 minutes after the clock opens or the knob turns) or for 6 s after the last puff, and only while the page keeps asking (it lapses by itself 8 s after the last request). phonelink reads the microphones on the Car Thing, turns each 40 ms into one loudness number and drops the sound: nothing is recorded, written or sent anywhere; only the number goes to the page over `127.0.0.1`. nocturned (and its wake word) is paused meanwhile and started again afterwards, also when phonelink is stopped. |
| **Inbound internet** | None. Every integration is an outbound request (including the new ones: GitHub API and the image registries, both read-only). |
| **LAN preview** | Read-only, and trimmed: no calendar events, security or update details, GitHub, Mei answers or security / CI banners for anyone but the Car Thing (or addresses you list in `PREVIEW_FULL_FROM`). A list of open ports and failed-login sources is a map for whoever is probing the LAN. |
| **Host reports** | `host-report.sh` runs from the normal user's crontab (reads the journal as a member of `adm`, no sudo). Its output reaches the hub as a file through a read-only mount (server 2) or inside the agent's authenticated push (server 1), where the hub keeps only the expected fields, clipped to fixed lengths. No new ports. |
| **Car Thing drift** | `check-carthing.sh` compares the device with the repository after Nocturne updates and hourly from cron, so a reset that turns password SSH back on or drops the hardening shows up as a red banner. Fixing needs a person to run it. |
| **Repository** | GitHub secret scanning and push protection are on; CI checks syntax and runs the tests on every push. |

## Two traps worth knowing

1. **Binding to a LAN address is not isolation.** Linux uses the weak host model: a packet for any of the host's addresses is accepted on any interface. A device behind the USB link can still reach the LAN address. Only per-interface firewall rules stop it.
2. **Docker-published ports skip UFW's INPUT rules.** Docker inserts its own `FORWARD` / `DOCKER` chains. Rules for published ports belong in `DOCKER-USER`.

## Privacy

* Mei sends your recorded question and the dashboard snapshot to the Gemini API. On Google's free tier, inputs may be used to improve Google's products. Do not ask Mei anything sensitive, or use a paid tier.
* Story summaries send the article text to Gemini in the same way.
* The morning briefing and Mei's answers include **today's and tomorrow's calendar entries** (times, titles, locations) in what is sent to Gemini. Leave `CALENDAR_ICS` empty, or set `BRIEFING_AT=off`, if that is not acceptable for your calendar.
* GitHub: with a token, names of private repositories and titles of their issues and pull requests are shown on the Car Thing (never on the LAN preview). Use a fine-grained token, read-only, limited to the repositories you want on the screen.
* Covers and lyrics: the title, artist and album (or the YouTube video's title and channel) and the length of what plays go from the hub to YouTube, Apple or LRCLIB to find a picture and lyrics, and the lyrics of a foreign song go to Gemini to be translated.
* Vocabulary: the list of words already learned goes to Gemini so it picks new ones.
* The internet check opens TCP connections to 1.1.1.1:443 and 8.8.8.8:443 (no data sent) and resolves www.google.com.
* For the morning briefing the Car Thing sends the hub **counts** only (notifications, missed calls, battery), which then go to Gemini with the rest of the briefing data. Notification text never leaves the Car Thing.
* Time at the desk (minutes per day) and reminders are kept on the hub, and hidden from the LAN preview.
* Nocturne's own daemon (`nocturned`) also connects to the paired iPhone (Apple's iAP2 link, and the same notification service). It runs on the Car Thing, which has no route to the LAN or the internet, so what it reads can only go back to the phone; it is waiting for Nocturne's phone app, which this setup does not use.
* Recordings are not stored: the Car Thing deletes the WAV after upload, and the hub keeps it in memory only for the request.

## Reporting

Found something? Open an issue without exploit details, and I will follow up.
