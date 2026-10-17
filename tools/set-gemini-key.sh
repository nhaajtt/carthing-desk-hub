#!/bin/bash
# Asks for a Gemini API key (shown as *), checks it with Google, then stores it in the hub's .env.
set -u
ENV_FILE="$HOME/carthing-hub/.env"
FORCE=${1:-}

printf '\e[?2004l'   # turn off bracketed paste so pasted text arrives as plain characters
trap 'printf "\e[?2004h"' EXIT
printf 'Paste your Gemini API key (Ctrl+V or right-click), then press Enter: '
key=""
while IFS= read -rsn1 c; do
  case "$c" in
    "") break ;;
    $'\x7f'|$'\b') [ -n "$key" ] && { key=${key%?}; printf '\b \b'; } ;;
    $'\e') read -rsn5 -t 0.01 _ ;;
    *) key+=$c; printf '*' ;;
  esac
done
echo
key=$(printf '%s' "$key" | tr -d '[:space:][:cntrl:]')   # keep every visible character
echo "Received ${#key} characters: starts with ${key:0:4}... ends with ...${key: -4}"
if [ ${#key} -lt 20 ]; then echo "That is too short to be a key. Nothing was saved."; exit 1; fi

resp=$(curl -s -w '\n%{http_code}' -H "x-goog-api-key: $key" "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1")
code=${resp##*$'\n'}
if [ "$code" != "200" ]; then
  echo "Google answered HTTP $code:"
  printf '%s\n' "${resp%$'\n'*}" | grep -oE '"(message|status|reason)": *"[^"]*"' | head -4
  if [ "$FORCE" != "--force" ]; then
    echo "Nothing was saved. To save it anyway, run: ~/carthing-tools/set-gemini-key.sh --force"
    exit 1
  fi
  echo "Saving anyway because of --force."
fi
umask 077
sed -i '/^GEMINI_API_KEY=/d' "$ENV_FILE"
printf 'GEMINI_API_KEY=%s\n' "$key" >> "$ENV_FILE"
cd "$HOME/carthing-hub" && docker compose up -d --force-recreate hub >/dev/null 2>&1
echo "Saved. The hub has been restarted."
