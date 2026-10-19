#!/bin/bash
# Keeps the kiosk on the right page. If Chromium is stuck on its error page (the hub was down when the
# page loaded, so the page's own code never ran), restart the kiosk: once the hub answers, or after a minute
# without it (kiosk-env then picks the car copy of the page).
# Started from /var/lib/hub/kiosk-env, so it lives and dies with the kiosk service.

PIDFILE=/run/hub-kiosk-watch.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi
echo $$ > "$PIDFILE"

HUB=http://10.42.1.6:8787
# Chromium's DevTools list of open pages (loopback only)
CDP=http://127.0.0.1:9223/json/list

sleep 60   # give a fresh boot time to load the page normally
fails=0
while :; do
  url=$(wget -qO- -T 3 "$CDP" 2>/dev/null | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' | head -n 1)
  case "$url" in
    "$HUB"/*)
      # the hub's page, but no hub for a minute: the page may be Chromium's error page, which never moves on
      if wget -q -T 3 -O /dev/null "$HUB/health"; then fails=0
      elif [ $((fails += 1)) -ge 4 ]; then
        logger -t kiosk-watch "no hub for a minute, restarting the kiosk"
        systemctl --no-block restart chromium-kiosk
        exit 0
      fi
      ;;
    *)
      # error page, blank page or anything else: reload the kiosk once the hub is reachable
      if wget -q -T 3 -O /dev/null "$HUB/health"; then
        logger -t kiosk-watch "kiosk showed '${url:-nothing}', restarting it"
        systemctl --no-block restart chromium-kiosk
        exit 0
      fi
      ;;
  esac
  sleep 15
done
