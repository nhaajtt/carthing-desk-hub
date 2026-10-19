#!/bin/bash
# Takes commands from the desk hub: records the microphone for the Ask page and uploads the clip,
# and restarts or shuts down the Car Thing when chosen in the Settings menu.
# Started from /var/lib/hub/kiosk-env, so it lives and dies with the kiosk service.

PIDFILE=/run/hub-voice.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi
echo $$ > "$PIDFILE"

HUB_HOST=10.42.1.6
HUB_PORT=8787
WAV=/tmp/hub-voice.wav
# The four real microphones are hw:0,0 (recorded at 16 kHz, 4 ch, 32-bit). nocturned keeps them open for its
# wake word, so it is paused while recording. (hw:0,1 is a silent loopback channel.)
MIC=hw:0,0

# GET a hub path and print the response body
hub_get() {
  local resp
  exec 3<>"/dev/tcp/$HUB_HOST/$HUB_PORT" || return 1
  printf 'GET %s HTTP/1.0\r\nHost: hub\r\n\r\n' "$1" >&3
  resp=$(timeout "$2" cat <&3)
  exec 3>&-
  printf '%s' "${resp##*$'\r\n\r\n'}"
}

upload() {
  local size
  size=$(stat -c %s "$WAV" 2>/dev/null) || return 1
  exec 3<>"/dev/tcp/$HUB_HOST/$HUB_PORT" || return 1
  printf 'POST /api/voice/audio?id=%s HTTP/1.0\r\nHost: hub\r\nContent-Type: audio/wav\r\nContent-Length: %s\r\n\r\n' "$1" "$size" >&3
  cat "$WAV" >&3
  timeout 10 cat <&3 >/dev/null
  exec 3>&-
  rm -f "$WAV"
}

while :; do
  cmd=$(hub_get /api/voice/cmd 30) || { sleep 2; continue; }
  set -- $cmd
  case "$1" in
    reboot) sync; systemctl reboot; exit 0 ;;
    poweroff) sync; systemctl poweroff; exit 0 ;;
    record) ;;
    *) continue ;;
  esac
  id=$2; max=${3:-15}
  rm -f "$WAV"
  # phonelink may hold the microphones (tap control, blowing on the torch): this file makes it let go
  touch /run/hub-mic-busy
  sleep 0.2
  systemctl stop nocturned
  arecord -q -D "$MIC" -f S32_LE -c 4 -r 16000 -d "$max" "$WAV" &
  rec=$!
  # tell the hub the microphone is really open, so the screen only says "Listening" from here on
  sleep 0.3
  kill -0 "$rec" 2>/dev/null && hub_get "/api/voice/started?id=$id" 3 >/dev/null
  # wait for "stop <id>" from the hub (it also sends one after the time limit)
  while :; do
    c=$(hub_get /api/voice/cmd 30) || { sleep 1; continue; }
    [ "$c" = "stop $id" ] && break
  done
  kill -INT "$rec" 2>/dev/null
  wait "$rec" 2>/dev/null
  rm -f /run/hub-mic-busy
  systemctl start --no-block nocturned
  upload "$id"
done
