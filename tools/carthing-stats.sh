#!/bin/bash
# Health of the Car Thing for the hub (Servers → Now): CPU, memory, temperature, storage, uptime and whether
# the kiosk and the helpers run. Read over SSH from server 2 (cron, every 2 minutes); only reads on the device.
#
#   carthing-stats.sh FILE     write JSON to FILE (the hub reads it through its read-only host-report mount)
set -u
CT=${CT:-root@10.42.1.2}
KEY=${KEY:-$HOME/.ssh/carthing_ed25519}
OUT=${1:?usage: carthing-stats.sh FILE}

remote=$(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$CT" 'sh -s' <<'REMOTE' 2>/dev/null
read -r _ a b c d e f g _ < /proc/stat; t1=$((a+b+c+d+e+f+g)); i1=$((d+e))
sleep 1
read -r _ a b c d e f g _ < /proc/stat; t2=$((a+b+c+d+e+f+g)); i2=$((d+e))
echo "cpu $(( 100 * ((t2 - t1) - (i2 - i1)) / (t2 - t1) ))"
awk '/^MemTotal/{t=$2} /^MemAvailable/{a=$2} END{print "mem", t, a}' /proc/meminfo
echo "temp $(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)"
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
echo "up $(cut -d. -f1 /proc/uptime)"
df -P /var | awk 'NR==2{print "disk", $2, $3}'
for p in brightness voice kiosk-watch phone; do
  if [ -f /run/hub-$p.pid ] && kill -0 "$(cat /run/hub-$p.pid)" 2>/dev/null; then echo "helper $p true"; else echo "helper $p false"; fi
done
echo "kiosk $(systemctl is-active chromium-kiosk)"
echo "version $(. /etc/os-release; echo $VERSION)"
REMOTE
)

tmp="$OUT.tmp"
if [ -z "$remote" ]; then
  jq -n --argjson at "$(date +%s)" '{at: ($at * 1000), reachable: false}' > "$tmp"
else
  val() { printf '%s\n' "$remote" | sed -n "s/^$1 //p"; }
  read -r memT memA <<<"$(val mem)"
  read -r diskT diskU <<<"$(val disk)"
  read -r l1 l5 l15 <<<"$(val load)"
  helpers=$(printf '%s\n' "$remote" | sed -n 's/^helper //p' | jq -R 'split(" ") | {(.[0]): (.[1] == "true")}' | jq -s 'add')
  jq -n --argjson at "$(date +%s)" --argjson cpu "$(val cpu)" --argjson memT "$memT" --argjson memA "$memA" \
    --argjson temp "$(val temp)" --argjson up "$(val up)" --argjson diskT "$diskT" --argjson diskU "$diskU" \
    --argjson l1 "$l1" --argjson l5 "$l5" --argjson l15 "$l15" --argjson helpers "$helpers" \
    --arg kiosk "$(val kiosk)" --arg version "$(val version)" \
    '{at: ($at * 1000), reachable: true, cpu: $cpu, memTotal: ($memT * 1024), memUsed: (($memT - $memA) * 1024),
      temp: ($temp / 1000), load: [$l1, $l5, $l15], uptime: $up, diskTotal: ($diskT * 1024), diskUsed: ($diskU * 1024),
      helpers: $helpers, kiosk: $kiosk, version: $version}' > "$tmp"
fi
chmod 644 "$tmp" && mv "$tmp" "$OUT"
