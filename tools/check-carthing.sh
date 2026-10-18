#!/bin/bash
# Checks that the Car Thing still has everything the desk hub installed on it, and puts back whatever is
# missing or different. Run it on server 2 after every Nocturne update (an update can reset /etc and /root).
#
#   check-carthing.sh            check, then fix what is wrong
#   check-carthing.sh --check    only report
#   check-carthing.sh --json F   only report, as JSON in file F (used from cron; the hub shows it)
#
# Source files come from ~/carthing-hub/carthing (the repository's carthing/ folder).
set -u
CT=${CT:-root@10.42.1.2}
KEY=${KEY:-$HOME/.ssh/carthing_ed25519}
SRC=${SRC:-$HOME/carthing-hub/carthing}
MODE=fix; JSON=""
case "${1:-}" in
  --check) MODE=check ;;
  --json) MODE=check; JSON=${2:?--json needs a file} ;;
  "") ;;
  *) echo "usage: $0 [--check | --json FILE]"; exit 2 ;;
esac

SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$CT")
say() { [ -z "$JSON" ] && printf '%s\n' "$*"; }

# target path on the Car Thing | file in $SRC | mode
FILES=(
  "/var/lib/hub/brightness-sync.sh|brightness-sync.sh|755"
  "/var/lib/hub/voice-agent.sh|voice-agent.sh|755"
  "/var/lib/hub/kiosk-watch.sh|kiosk-watch.sh|755"
  "/var/lib/hub/kiosk-env|kiosk-env|644"
  "/var/lib/hub/phonelink|phonelink/phonelink|755"
  "/etc/systemd/timesyncd.conf.d/10-hub.conf|10-hub.conf|644"
  "/etc/ssh/sshd_config.d/10-hardening.conf|10-hardening.conf|644"
  "/etc/systemd/system.conf.d/10-watchdog.conf|10-watchdog.conf|644"
)
PUB=$(cat "$KEY.pub")

write_json() {
  [ -z "$JSON" ] && return
  local reachable=$1 version=$2; shift 2
  local tmp="$JSON.tmp"
  printf '%s\n' "$@" | jq -R . | jq -s --argjson at "$(date +%s)" --argjson reachable "$reachable" --arg version "$version" \
    '{at: ($at * 1000), reachable: $reachable, version: $version, problems: map(select(length > 0))}' > "$tmp" \
    && chmod 644 "$tmp" && mv "$tmp" "$JSON"
}

# ---------------------------------------------------------------- 1. can we still log in with the hub's key?
if ! "${SSH[@]}" true 2>/dev/null; then
  if ! ping -c1 -W2 "${CT#*@}" >/dev/null 2>&1; then
    say "The Car Thing does not answer on ${CT#*@}. Is it plugged in and booted?"
    write_json false "" "Car Thing not reachable"
    exit 1
  fi
  say "Key login failed: the update probably reset /root/.ssh/authorized_keys (and SSH settings)."
  if [ "$MODE" != fix ] || [ ! -t 0 ]; then
    write_json false "" "SSH key login no longer works"
    say "Run this script in a terminal (without --check) to put the key back."
    exit 1
  fi
  say "ssh will now ask for the Car Thing's root password once (Nocturne's default is: nocturne)."
  printf '%s\n' "$PUB" | ssh -o PubkeyAuthentication=no -o ConnectTimeout=8 "$CT" \
    'mount -o remount,rw / && mkdir -p /root/.ssh && chmod 700 /root/.ssh && cat > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys; sync; mount -o remount,ro /' \
    || { say "Could not put the key back."; exit 1; }
  "${SSH[@]}" true 2>/dev/null || { say "Key login still fails."; exit 1; }
  say "Key restored."
fi

# ---------------------------------------------------------------- 2. read the current state in one go
remote=$("${SSH[@]}" 'sh -s' <<REMOTE 2>/dev/null
for f in $(printf '%s ' "${FILES[@]}" | sed 's/|[^ ]*//g'); do
  if [ -f "\$f" ]; then echo "file \$f \$(sha256sum "\$f" | cut -d" " -f1) \$(stat -c %a "\$f")"; else echo "file \$f missing -"; fi
done
echo "kiosk \$(grep -c '^KIOSK_ENV_OVERRIDE_FILE=/var/lib/hub/kiosk-env\$' /etc/default/chromium-kiosk 2>/dev/null)"
grep -qxF '$PUB' /root/.ssh/authorized_keys 2>/dev/null && echo "key ok" || echo "key missing"
echo "sshd \$(sshd -T 2>/dev/null | grep -E '^(passwordauthentication|permitemptypasswords) ' | tr ' \n' '=,')"
echo "timesyncd \$(systemctl is-enabled systemd-timesyncd 2>/dev/null) \$(systemctl is-active systemd-timesyncd 2>/dev/null)"
for p in brightness voice kiosk-watch phone; do
  if [ -f /run/hub-\$p.pid ] && kill -0 "\$(cat /run/hub-\$p.pid)" 2>/dev/null; then echo "helper \$p up"; else echo "helper \$p down"; fi
done
echo "version \$(. /etc/os-release; echo \$VERSION)"
REMOTE
)
version=$(printf '%s\n' "$remote" | sed -n 's/^version //p')
say "Car Thing: Nocturne ${version:-unknown}"

problems=(); fix_files=(); etc_change=0; helper_change=0; sshd_change=0; watchdog_change=0; timesync_change=0; kiosk_default=0
for entry in "${FILES[@]}"; do
  IFS='|' read -r dst name mode <<<"$entry"
  # the Bluetooth helper is built, not stored in the repository (tools/build-phonelink.sh)
  if [ ! -f "$SRC/$name" ]; then problems+=("not built yet: $SRC/$name (run tools/build-phonelink.sh)"); continue; fi
  want=$(sha256sum "$SRC/$name" | cut -d' ' -f1)
  read -r _ _ have hmode < <(printf '%s\n' "$remote" | grep "^file $dst ")
  if [ "$have" != "$want" ] || [ "$hmode" != "$mode" ]; then
    [ "$have" = missing ] && problems+=("missing: $dst") || problems+=("changed: $dst")
    fix_files+=("$entry")
    case "$dst" in
      /etc/*) etc_change=1 ;;
      *) helper_change=1 ;;
    esac
    case "$name" in
      10-hardening.conf) sshd_change=1 ;;
      10-watchdog.conf) watchdog_change=1 ;;
      10-hub.conf) timesync_change=1 ;;
    esac
  fi
done
grep -q '^kiosk 1$' <<<"$remote" || { problems+=("kiosk no longer points at the hub (/etc/default/chromium-kiosk)"); kiosk_default=1; etc_change=1; }
grep -q '^key ok$' <<<"$remote" || problems+=("hub key missing from authorized_keys")
grep -q 'passwordauthentication=no' <<<"$remote" || { problems+=("SSH accepts passwords again"); sshd_change=1; }
grep -q '^timesyncd enabled active$' <<<"$remote" || { problems+=("time sync from the hub is off"); timesync_change=1; }
while read -r _ p st; do [ "$st" = down ] && problems+=("helper not running: $p"); done < <(grep '^helper ' <<<"$remote")

if [ ${#problems[@]} -eq 0 ]; then
  say "Everything is in place."
  write_json true "$version"
  exit 0
fi
say "Found ${#problems[@]} problem(s):"
for p in "${problems[@]}"; do say "  - $p"; done
write_json true "$version" "${problems[@]}"
[ "$MODE" = fix ] || exit 1

# ---------------------------------------------------------------- 3. fix
say "Fixing..."
cmds=""
[ $etc_change = 1 ] || ! grep -q '^key ok$' <<<"$remote" && cmds+="mount -o remount,rw / && "
cmds+="mkdir -p /var/lib/hub /etc/systemd/timesyncd.conf.d /etc/ssh/sshd_config.d /etc/systemd/system.conf.d /root/.ssh"
for entry in "${fix_files[@]}"; do
  IFS='|' read -r dst name mode <<<"$entry"
  tmp=/tmp/hub-fix.${name##*/}
  "${SSH[@]}" "cat > $tmp" < "$SRC/$name" || { say "upload of $name failed"; exit 1; }
  cmds+=" && install -m $mode $tmp $dst && rm -f $tmp"
done
[ $kiosk_default = 1 ] && cmds+=" && { [ -f /etc/default/chromium-kiosk.orig ] || cp -p /etc/default/chromium-kiosk /etc/default/chromium-kiosk.orig; } && sed -i 's#^KIOSK_ENV_OVERRIDE_FILE=.*#KIOSK_ENV_OVERRIDE_FILE=/var/lib/hub/kiosk-env#' /etc/default/chromium-kiosk && { grep -q '^KIOSK_ENV_OVERRIDE_FILE=' /etc/default/chromium-kiosk || echo 'KIOSK_ENV_OVERRIDE_FILE=/var/lib/hub/kiosk-env' >> /etc/default/chromium-kiosk; }"
grep -q '^key ok$' <<<"$remote" || cmds+=" && grep -qxF '$PUB' /root/.ssh/authorized_keys 2>/dev/null || echo '$PUB' >> /root/.ssh/authorized_keys"
[ $etc_change = 1 ] || ! grep -q '^key ok$' <<<"$remote" && cmds+=" && sync && mount -o remount,ro /"
[ $watchdog_change = 1 ] && cmds+=" && systemctl daemon-reexec"
# sshd is socket-activated on Nocturne: every new connection reads the config, so a syntax check is enough
[ $sshd_change = 1 ] && cmds+=" && sshd -t"
[ $timesync_change = 1 ] && cmds+=" && systemctl unmask systemd-timesyncd; systemctl enable systemd-timesyncd && systemctl restart systemd-timesyncd"
# helpers start with the kiosk; stop the old copies so the new files are the ones that run
cmds+=" && for p in brightness voice kiosk-watch phone; do [ -f /run/hub-\$p.pid ] && kill \$(cat /run/hub-\$p.pid) 2>/dev/null; rm -f /run/hub-\$p.pid; done; systemctl restart chromium-kiosk"
"${SSH[@]}" "$cmds" || { say "A fix step failed (see above). Check by hand: ssh -i $KEY $CT"; exit 1; }
say "Done. Checking again in 20 s..."
sleep 20
# refresh what the hub shows, if the cron report is in use
REPORT=$HOME/carthing-hub/host-report/carthing.json
[ -f "$REPORT" ] && "$0" --json "$REPORT"
exec "$0" --check
