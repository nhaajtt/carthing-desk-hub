#!/bin/bash
# Asks for a GitHub token (shown as *), checks it with GitHub, then stores it in the hub's .env.
# Use a fine-grained token with read-only access: Metadata, Actions, Issues and Pull requests.
set -u
ENV_FILE="$HOME/carthing-hub/.env"

printf '\e[?2004l'   # turn off bracketed paste so pasted text arrives as plain characters
trap 'printf "\e[?2004h"' EXIT
printf 'Paste your GitHub token (Ctrl+V or right-click), then press Enter: '
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
key=$(printf '%s' "$key" | tr -d '[:space:][:cntrl:]')
echo "Received ${#key} characters: starts with ${key:0:4}... ends with ...${key: -4}"
if [ ${#key} -lt 20 ]; then echo "That is too short to be a token. Nothing was saved."; exit 1; fi

resp=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $key" -H 'Accept: application/vnd.github+json' https://api.github.com/user)
code=${resp##*$'\n'}
if [ "$code" != "200" ]; then
  echo "GitHub answered HTTP $code. Nothing was saved."
  exit 1
fi
login=$(printf '%s\n' "${resp%$'\n'*}" | grep -oE '"login": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
echo "Token works for: $login"
umask 077
sed -i '/^GITHUB_TOKEN=/d' "$ENV_FILE"
printf 'GITHUB_TOKEN=%s\n' "$key" >> "$ENV_FILE"
grep -q '^GITHUB_USER=.' "$ENV_FILE" || { sed -i '/^GITHUB_USER=/d' "$ENV_FILE"; printf 'GITHUB_USER=%s\n' "$login" >> "$ENV_FILE"; }
cd "$HOME/carthing-hub" && docker compose up -d --force-recreate hub >/dev/null 2>&1
echo "Saved. The hub has been restarted."
