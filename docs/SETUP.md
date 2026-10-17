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
mkdir -p state
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
scp carthing/brightness-sync.sh carthing/voice-agent.sh carthing/kiosk-env $CT:/var/lib/hub/
ssh $CT 'chmod 755 /var/lib/hub/*.sh'

# one-time edits on the read-only system partition
ssh $CT 'mount -o remount,rw / &&
  cp -p /etc/default/chromium-kiosk /etc/default/chromium-kiosk.orig &&
  sed -i "s#^KIOSK_ENV_OVERRIDE_FILE=.*#KIOSK_ENV_OVERRIDE_FILE=/var/lib/hub/kiosk-env#" /etc/default/chromium-kiosk &&
  mkdir -p /root/.ssh /etc/systemd/timesyncd.conf.d && sync && mount -o remount,ro /'
```

Key-only SSH (from the brain), NTP from the brain, then lock the partition again:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/carthing_ed25519 -N ""            # on the brain
ssh $CT 'mount -o remount,rw /'
scp ~/.ssh/carthing_ed25519.pub $CT:/root/.ssh/authorized_keys
scp carthing/10-hub.conf $CT:/etc/systemd/timesyncd.conf.d/
scp carthing/10-hardening.conf $CT:/etc/ssh/sshd_config.d/
ssh $CT 'sshd -t && systemctl unmask systemd-timesyncd; systemctl enable systemd-timesyncd; sync; mount -o remount,ro /; systemctl reload sshd; systemctl restart systemd-timesyncd chromium-kiosk'
```

Test the key login **before** reloading sshd with the hardening file.

To return to the stock Nocturne UI: `rm /var/lib/hub/kiosk-env` and restart `chromium-kiosk`.

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

## Development helpers

`tools/` holds the scripts used while building: `cdp.mjs` (screenshot / eval over DevTools), `errors.mjs` / `errors2.mjs` (reload and print exceptions), `shoot*.mjs` (the README screenshots). Open the tunnel first:

```bash
ssh -i ~/.ssh/carthing_ed25519 -f -N -L 127.0.0.1:19223:127.0.0.1:9223 root@10.42.1.2
docker run --rm --network host -v "$PWD/tools:/t" -w /t node:22-bookworm-slim node cdp.mjs shot /t/screen.png
```
