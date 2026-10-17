#!/bin/bash
# Asks for one or more secret iCal addresses (shown as *), checks that each one is a calendar,
# then stores them in the hub's .env. Google Calendar: Settings > your calendar >
# "Integrate calendar" > "Secret address in iCal format". Anyone with that link can read the calendar,
# so it is never echoed, logged or sent to the Car Thing.
set -u
ENV_FILE="$HOME/carthing-hub/.env"

read_secret() {
  local s="" c
  printf '\e[?2004l'   # turn off bracketed paste so pasted text arrives as plain characters
  while IFS= read -rsn1 c; do
    case "$c" in
      "") break ;;
      $'\x7f'|$'\b') [ -n "$s" ] && { s=${s%?}; printf '\b \b' >&2; } ;;
      $'\e') read -rsn5 -t 0.01 _ ;;
      *) s+=$c; printf '*' >&2 ;;
    esac
  done
  printf '\e[?2004h'
  echo >&2
  printf '%s' "$s" | tr -d '[:space:][:cntrl:]'
}

urls=()
while :; do
  printf 'Paste a secret iCal address (or just press Enter to finish): ' >&2
  u=$(read_secret)
  [ -z "$u" ] && break
  case "$u" in https://*) ;; *) echo "That does not start with https:// , skipped." >&2; continue ;; esac
  if curl -sf --max-time 20 "$u" | head -c 200000 | grep -q 'BEGIN:VCALENDAR'; then
    n=$(curl -sf --max-time 20 "$u" | grep -c 'BEGIN:VEVENT')
    echo "OK: a calendar with $n events." >&2
    urls+=("$u")
  else
    echo "That link did not return a calendar, skipped." >&2
  fi
done

if [ ${#urls[@]} -eq 0 ]; then echo "Nothing was saved."; exit 1; fi
umask 077
sed -i '/^CALENDAR_ICS=/d' "$ENV_FILE"
printf 'CALENDAR_ICS=%s\n' "${urls[*]}" >> "$ENV_FILE"
cd "$HOME/carthing-hub" && docker compose up -d --force-recreate hub >/dev/null 2>&1
echo "Saved ${#urls[@]} calendar(s). The hub has been restarted."
