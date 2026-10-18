#!/bin/bash
# Writes a small JSON report about this host for the desk hub's Servers page:
# failed SSH logins, packets UFW blocked, ports open on every interface, and pending apt updates.
# Runs from the user's crontab (no root: the journal is readable by the adm group).
#   */5 * * * * /path/to/host-report.sh /path/to/report.json
set -u
OUT=${1:?usage: host-report.sh /path/to/report.json}
NOW=$(date +%s)
H1=$((NOW - 3600))

# "<epoch> <message>" lines from the journal for the last 24 h
since24() { journalctl --since "-24h" -o short-unix --no-pager -q "$@" 2>/dev/null; }

# failed SSH logins: count for 1 h / 24 h and the busiest source addresses
ssh_json=$(since24 -u ssh -u sshd | awk -v h1="$H1" '
  /Invalid user .* from |Failed (password|publickey) for |Connection closed by authenticating user / {
    t = int($1); n24++; if (t >= h1) n1++
    if (match($0, /([0-9]{1,3}\.){3}[0-9]{1,3}/)) ip[substr($0, RSTART, RLENGTH)]++
  }
  END {
    printf "{\"fail1h\":%d,\"fail24h\":%d,\"top\":[", n1, n24
    k = 0
    while (k < 3) {
      best = ""; bn = 0
      for (a in ip) if (ip[a] > bn) { best = a; bn = ip[a] }
      if (best == "") break
      printf "%s{\"ip\":\"%s\",\"n\":%d}", (k ? "," : ""), best, bn
      delete ip[best]; k++
    }
    printf "]}"
  }')

# packets UFW dropped, without the multicast / broadcast noise every LAN produces
ufw_json=$(since24 -k | awk -v h1="$H1" '
  /\[UFW BLOCK\]/ {
    dst = ""; src = ""; dpt = ""; inif = ""; proto = ""; syn = 0; ack = 0
    for (i = 2; i <= NF; i++) {
      if ($i ~ /^DST=/) dst = substr($i, 5)
      else if ($i ~ /^SRC=/) src = substr($i, 5)
      else if ($i ~ /^DPT=/) dpt = substr($i, 5)
      else if ($i ~ /^IN=/) inif = substr($i, 4)
      else if ($i ~ /^PROTO=/) proto = substr($i, 7)
      else if ($i == "SYN") syn = 1
      else if ($i == "ACK") ack = 1
    }
    if (dst ~ /^ff0/ || dst ~ /^2(2[4-9]|3[0-9])\./ || dst ~ /\.255$/) next
    # TCP: only new connection attempts; late ACK/FIN/RST packets of closed connections are noise
    if (proto == "TCP" && (!syn || ack)) next
    t = int($1); n24++; if (t >= h1) n1++
    key = src (dpt != "" ? " → " dpt : ""); hit[key]++; via[key] = inif
  }
  END {
    printf "{\"block1h\":%d,\"block24h\":%d,\"top\":[", n1, n24
    k = 0
    while (k < 3) {
      best = ""; bn = 0
      for (a in hit) if (hit[a] > bn) { best = a; bn = hit[a] }
      if (best == "") break
      printf "%s{\"what\":\"%s\",\"via\":\"%s\",\"n\":%d}", (k ? "," : ""), best, via[best], bn
      delete hit[best]; k++
    }
    printf "]}"
  }')

# listening sockets bound to every interface (0.0.0.0, [::] or *), deduplicated per protocol/port
listen_json=$(ss -ltnuH 2>/dev/null | awk '
  { split($5, a, ":"); port = a[length(a)]; addr = substr($5, 1, length($5) - length(port) - 1)
    if (addr == "0.0.0.0" || addr == "*" || addr == "[::]") seen[$1 "/" port] = 1 }
  END { k = 0; printf "["; for (s in seen) { printf "%s\"%s\"", (k ? "," : ""), s; k++ } printf "]" }')

upg=$(apt list --upgradable 2>/dev/null | tail -n +2)
apt_n=$(printf '%s' "$upg" | grep -c . || true)
apt_sec=$(printf '%s' "$upg" | grep -c -- '-security' || true)
reboot=false; [ -f /var/run/reboot-required ] && reboot=true

tmp="$OUT.tmp"
jq -n --argjson at "$NOW" --arg host "$(hostname)" \
  --argjson ssh "$ssh_json" --argjson ufw "$ufw_json" --argjson listen "$listen_json" \
  --argjson apt "$apt_n" --argjson sec "$apt_sec" --argjson reboot "$reboot" \
  '{at: ($at * 1000), host: $host, ssh: $ssh, ufw: $ufw, listen: ($listen | sort), apt: {upgradable: $apt, security: $sec, reboot: $reboot}}' \
  > "$tmp" && chmod 644 "$tmp" && mv "$tmp" "$OUT"
