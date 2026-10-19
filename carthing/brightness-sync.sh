#!/bin/bash
# Applies the screen brightness chosen on the desk hub (server 2). 0 means "night": backlight off.
# Without the hub for a minute (in the car), it hands the screen back to Nocturne's automatic brightness,
# which follows the light sensor.
# Started from /var/lib/hub/kiosk-env, so it lives and dies with the kiosk service.

PIDFILE=/run/hub-brightness.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi
echo $$ > "$PIDFILE"

HUB_HOST=10.42.1.6
HUB_PORT=8787
BL=/sys/class/backlight/backlight
MAX=$(cat "$BL/max_brightness")
# nocturned owns the backlight; with auto=true it follows the light sensor and overrides us
NOCTURNE_CFG=/var/lib/brightness.json
applied=""   # level the screen should be at now (0 = off for the night)
saved=""     # level stored in nocturned's config
missed=0     # polls in a row without the hub

# Daytime levels are saved where nocturned keeps them, and nocturned is restarted so it loads them.
# Night (0) and waking up again only touch the backlight, so the screen reacts within one poll.
apply() {
  local raw=$(( $1 * MAX / 100 ))
  if [ "$1" -gt 0 ] && [ "$1" != "$saved" ]; then
    printf '{"auto":false,"brightness":%d}' "$raw" > "$NOCTURNE_CFG.tmp" && mv "$NOCTURNE_CFG.tmp" "$NOCTURNE_CFG"
    systemctl restart nocturned
    sleep 2
    saved=$1
  fi
  echo "$raw" > "$BL/brightness"
}

[ -f "$NOCTURNE_CFG.orig" ] || cp "$NOCTURNE_CFG" "$NOCTURNE_CFG.orig" 2>/dev/null

fetch_pct() {
  exec 3<>"/dev/tcp/$HUB_HOST/$HUB_PORT" || return 1
  printf 'GET /api/brightness HTTP/1.0\r\nHost: hub\r\n\r\n' >&3
  timeout 3 cat <&3 | tail -n 1
  exec 3>&-
}

while :; do
  pct=$(fetch_pct 2>/dev/null)
  if [ -z "$pct" ]; then
    if [ $((missed += 1)) -eq 30 ] && [ -f "$NOCTURNE_CFG.orig" ] && ! cmp -s "$NOCTURNE_CFG.orig" "$NOCTURNE_CFG"; then
      cp "$NOCTURNE_CFG.orig" "$NOCTURNE_CFG" && systemctl restart nocturned
      applied="" saved=""
    fi
  else
    missed=0
  fi
  if [[ "$pct" =~ ^[0-9]+$ ]] && { [ "$pct" -eq 0 ] || { [ "$pct" -ge 5 ] && [ "$pct" -le 100 ]; }; } && [ "$pct" != "$applied" ]; then
    apply "$pct" && applied=$pct
  fi
  # nocturned drops the backlight to 0 whenever it restarts (the voice agent pauses it to use the mics)
  if [ -n "$applied" ]; then
    raw=$(( applied * MAX / 100 ))
    [ "$(cat "$BL/brightness")" != "$raw" ] && echo "$raw" > "$BL/brightness"
  fi
  sleep 2
done
