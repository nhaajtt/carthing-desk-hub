# Setup

What you need: a Spotify Car Thing, a Linux machine with Docker that sits next to it (the "brain"; this guide uses Ubuntu 26.04), and optionally a second server for the stats agent.

Addresses used below: brain on the LAN `10.10.10.20`, second server `10.10.10.21`, USB link `10.42.1.0/29` (brain `10.42.1.6`, Car Thing `10.42.1.2`). Adjust to your network.

## 1. Flash Nocturne 4

1. Download the latest image zip from [Nocturne releases](https://github.com/usenocturne/nocturne/releases) and [`flashthing-cli`](https://github.com/JoeyEamigh/flashthing/releases).
2. Unplug the Car Thing, hold **preset buttons 1 and 4**, plug it in, keep holding for ~3 s. The host sees `GX-CHIP` (`1b8e:c003`). Windows needs a WinUSB driver for that device; Linux needs `flashthing-cli --setup` for the udev rule.
3. `flashthing-cli nocturne_image_vX.Y.Z.zip`
   If it fails with `USB error: Operation timed out` during "erasing … sectors", run the same command again: the erase keeps going on the device.
4. Replug normally. The Car Thing appears as a USB network adapter (CDC-NCM) and as `nocturne.local`.

## 2. Brain: network and firewall

Plug the Car Thing into the brain and note its interface name (`ip -br link`, an `enx…` name) and MAC.

```bash
# fixed address on the USB link, nothing accepted from the device
sudo cp host/60-carthing.yaml /etc/netplan/ && sudo chmod 600 /etc/netplan/60-carthing.yaml
sudoedit /etc/netplan/60-carthing.yaml        # set the Car Thing's MAC
sudo netplan generate && sudo networkctl reload

# Docker may publish on 10.42.1.6 before the Car Thing exists
sudo cp host/60-carthing-hub.conf /etc/sysctl.d/ && sudo sysctl -p /etc/sysctl.d/60-carthing-hub.conf

# NTP for the Car Thing (chrony)
sudo cp host/chrony-carthing.conf /etc/chrony/conf.d/carthing.conf && sudo systemctl restart chrony

# firewall: DOCKER-USER rules for the USB interface, then UFW
sudo sh -c 'cat host/ufw-after.rules.snippet >> /etc/ufw/after.rules'   # replace enxCARTHING first
sudo LAN_IF=enx… CT_IF=enx… sh host/ufw-rules.sh
```

Allow SSH from the LAN **before** enabling UFW over SSH (the script does it first).

## 3. Brain: the hub

```bash
cd hub
cp .env.example .env && chmod 600 .env    # fill INGEST_TOKEN, GEMINI_API_KEY, SPOTIFY_CLIENT_ID as wanted
sudoedit docker-compose.yml                # group_add: the GID of /var/run/docker.sock (stat -c %g)
mkdir -p state host-report    # create both yourself, or Docker creates them owned by root
docker compose up -d
curl -s http://10.10.10.20:8787/health     # ok
```

Edit `config.json` for your coins, indices and alert rules, then `docker restart carthing-hub`.

**Gemini key** without it landing in your shell history: copy `tools/set-gemini-key.sh` to the brain and run `ssh -t user@brain ~/set-gemini-key.sh`. It shows `*` per character and checks the key with Google before saving.

## 4. Car Thing

The hub's helpers live on the data partition (`/var/lib/hub`), because Nocturne restores `/opt/nocturne` on every boot (`nocturne-floor-sync`).

```bash
CT=root@10.42.1.2          # default Nocturne password: nocturne (change access below)
ssh $CT 'mkdir -p /var/lib/hub'
scp carthing/brightness-sync.sh carthing/voice-agent.sh carthing/kiosk-watch.sh carthing/kiosk-env $CT:/var/lib/hub/
ssh $CT 'chmod 755 /var/lib/hub/*.sh'

# one-time edits on the read-only system partition
ssh $CT 'mount -o remount,rw / &&
  cp -p /etc/default/chromium-kiosk /etc/default/chromium-kiosk.orig &&
  sed -i "s#^KIOSK_ENV_OVERRIDE_FILE=.*#KIOSK_ENV_OVERRIDE_FILE=/var/lib/hub/kiosk-env#" /etc/default/chromium-kiosk &&
  mkdir -p /root/.ssh /etc/systemd/timesyncd.conf.d /etc/systemd/system.conf.d && sync && mount -o remount,ro /'
```

Key-only SSH (from the brain), NTP from the brain, then lock the partition again:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/carthing_ed25519 -N ""            # on the brain
ssh $CT 'mount -o remount,rw /'
scp ~/.ssh/carthing_ed25519.pub $CT:/root/.ssh/authorized_keys
scp carthing/10-hub.conf $CT:/etc/systemd/timesyncd.conf.d/
scp carthing/10-hardening.conf $CT:/etc/ssh/sshd_config.d/
scp carthing/10-watchdog.conf $CT:/etc/systemd/system.conf.d/   # reboot by itself if it ever freezes
ssh $CT 'sshd -t && systemctl unmask systemd-timesyncd; systemctl enable systemd-timesyncd; sync; mount -o remount,ro /; systemctl daemon-reexec; systemctl restart systemd-timesyncd chromium-kiosk'
```

Check the watchdog is armed: `journalctl -b | grep -i watchdog` should say `Watchdog running with a hardware timeout of 30s`.

Test the key login **before** copying the hardening file: sshd is socket-activated on Nocturne, so the next connection already uses it.

To return to the stock Nocturne UI: `rm /var/lib/hub/kiosk-env` and restart `chromium-kiosk`.

### After every Nocturne update

An update can reset `/etc` and `/root` on the Car Thing: the kiosk override, key-only SSH, time sync, the watchdog. Put the repository's `carthing/` folder at `~/carthing-hub/carthing` on the brain, copy `tools/check-carthing.sh` next to the other tools, and run it:

```bash
~/carthing-tools/check-carthing.sh            # check, then put back whatever is missing or different
~/carthing-tools/check-carthing.sh --check    # only report
```

It compares every file with the copy in `carthing/` (SHA-256), checks the kiosk points at the hub, the hub's key is in `authorized_keys`, sshd refuses passwords, time sync is on and the helpers (including phonelink, once built) are running. If the update wiped the key, it asks for the root password once (Nocturne's default is `nocturne`) to put the key back, then continues with the key. Run hourly from cron with `--json`, it also feeds the Car Thing card on Servers → Security (see section 9).

## 5. Optional: stats from a second server

```bash
cd agent
cp .env.example .env && chmod 600 .env    # INGEST_TOKEN = the hub's value
docker compose up -d
```

The hub only accepts it from `INGEST_FROM` with the right token.

## 6. Optional: Spotify

1. Create an app at <https://developer.spotify.com/dashboard> with redirect URI `http://127.0.0.1:8888/callback` and the Web API. Put the **Client ID** (not the secret) in `hub/.env`, restart the hub.
2. From a computer on the LAN: `ssh -N -L 127.0.0.1:8888:10.10.10.20:8787 user@brain` (keeps the callback on loopback, as Spotify requires).
3. Open `http://10.10.10.20:8787/spotify/link`, sign in, press **Agree**. Close the tunnel.

## 7. Optional: Calendar

1. Google Calendar on the web: **Settings → (your calendar) → Integrate calendar → Secret address in iCal format**. Copy it. Anyone with this link can read that calendar, so treat it like a password.
2. Copy `tools/set-calendar-url.sh` to the brain and run `ssh -t user@brain ~/set-calendar-url.sh`. Paste one link per prompt (shown as `*`), press Enter on an empty prompt to finish. Each link is checked before it is saved to `.env`, then the hub restarts.

Several calendars are fine; each gets its own colour on the Calendar page.

## 8. Optional: morning briefing

On by default at 07:00 in `WX_TZ`. Change it with `BRIEFING_AT=06:30` (or `off`) in `hub/.env`, then restart the hub. It is written in the screen language (quick menu → language); `BRIEFING_LANG=Vietnamese` pins one regardless. Button 1 on Mei's page asks for one any time.

## 9. Optional: Servers → 24 h, Security and Updates

The graphs need nothing: the hub keeps 24 hours of 10-minute averages in `state/history.json`.

Security and update details come from `host/host-report.sh`, run from the normal user's crontab on each server (no root: members of `adm` can read the journal). It writes failed SSH logins, packets UFW blocked (new connections only, without multicast noise), sockets listening on every interface and pending apt updates to a JSON file.

```bash
# server 2: the hub reads ./host-report through a read-only mount (see docker-compose.yml)
mkdir -p ~/carthing-hub/host-report
crontab -e
*/5 * * * * $HOME/carthing-tools/host-report.sh $HOME/carthing-hub/host-report/report.json
17 * * * * $HOME/carthing-tools/check-carthing.sh --json $HOME/carthing-hub/host-report/carthing.json >/dev/null 2>&1

# server 1: the agent reads ./report (read-only) and sends it with its stats once a minute
mkdir -p /srv/apps/hub-stats-agent/report
*/5 * * * * /srv/apps/hub-stats-agent/host-report.sh /srv/apps/hub-stats-agent/report/report.json
```

The first report from each server counts what is already open as known. After that, a port that starts listening on every interface (on the host, or a Docker port published on `0.0.0.0`) raises a banner and is marked **new** for a day. Five or more failed SSH logins in an hour also raise one (`SSH_ALERT`).

Containers with a newer image: the docker-status sidecars report each image and the digest it was pulled by; every 6 hours the hub asks the registry (anonymous `HEAD`, which Docker Hub does not count as a pull) for the digest the same tag has now. Images built locally show as unknown and are left out of the count.

GitHub: set `GITHUB_USER` in `hub/.env`. Public repositories need no token. For private ones, create a fine-grained token with read-only Metadata, Actions, Issues and Pull requests, and store it with `ssh -t user@brain ~/carthing-tools/set-github-token.sh`.

Car Thing health on Servers → Now comes from one more cron line on server 2 (read-only SSH, every 2 minutes):

```bash
*/2 * * * * $HOME/carthing-tools/carthing-stats.sh $HOME/carthing-hub/host-report/carthing-stats.json >/dev/null 2>&1
```

## 10. Optional: night

`NIGHT_DIM=23:00-06:30` (the default; `off` to disable) turns the backlight off between those times. The first knob turn, button press or tap only wakes the screen, for `WAKE_MINUTES` (2), and every further input keeps it awake.

## 11. Optional: iPhone over Bluetooth

Battery, notifications, incoming calls and what any app plays, from one iPhone, with nothing installed on the phone. Build the helper on the brain (official Go image, Alpine variant, static arm64 binary) and let `check-carthing.sh` put it on the Car Thing:

```bash
~/carthing-tools/build-phonelink.sh     # writes ~/carthing-hub/carthing/phonelink/phonelink
~/carthing-tools/check-carthing.sh      # copies it to /var/lib/hub/phonelink and restarts the kiosk
```

Pair: quick menu → **iPhone** → on the iPhone, Settings → Bluetooth → **Desk Hub** (an iPhone that met this Car Thing before may show it as "Nocturne (…)"; if it sits under My Devices, choose Forget This Device first) → type the 6-digit code from the screen → allow notifications. To unpair, quick menu → iPhone → press again to confirm, and forget the device on the iPhone too.

"At the desk" uses the link's signal strength: `-near` (default `-62` dBm, held 4 s) and `-far` (`-78` dBm, held 20 s). If your room needs other values, watch `rssi` on the iPhone page's signal bars (or `PH.rssi` over DevTools) at the desk and across the room, and add the flags to the phonelink line in `carthing/kiosk-env`.

`DESK_SIT_MINUTES` (default 60) sets when the stand-up banner shows.

If Siri does not open from button 1 after an update of phonelink, forget the device on the iPhone and pair again: iOS keeps the remote's key list from the first pairing.

## Development helpers

`tools/` holds the scripts used while building: `cdp.mjs` (screenshot / eval over DevTools), `steps.mjs` (a list of key presses, evals and screenshots, printing every exception), `errors.mjs` / `errors2.mjs` (reload and print exceptions), `shoot*.mjs` (the README screenshots; `demo-calendar.js` supplies sample events), `record.mjs` (frames for the README GIF). Open the tunnel first:

```bash
ssh -i ~/.ssh/carthing_ed25519 -f -N -L 127.0.0.1:19223:127.0.0.1:9223 root@10.42.1.2
docker run --rm --network host -v "$PWD/tools:/t" -w /t node:22-bookworm-slim node cdp.mjs shot /t/screen.png
```

The GIF: `node record.mjs /t/rec`, then in a throwaway container with ffmpeg:

```bash
ffmpeg -f concat -safe 0 -i frames.txt \
  -vf "fps=12,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" tour.gif
```

Tests (no dependencies): `cd hub && node --test test/*.test.mjs`.
