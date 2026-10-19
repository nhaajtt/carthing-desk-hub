#!/bin/bash
# Copies what the hub packed for the car (state/carpack: covers, lyrics, the forecast, the calendar, reminders)
# to the Car Thing, where phonelink serves it to the car copy of the page. Only new files go over the cable;
# files the hub dropped are removed. pack.json goes last, so the page never sees it before the files it names.
# Run from cron on server 2 every few minutes:
#   */5 * * * * $HOME/carthing-tools/sync-carpack.sh >/dev/null 2>&1

set -u
CT=${CT:-root@10.42.1.2}
KEY=${KEY:-$HOME/.ssh/carthing_ed25519}
SRC=${SRC:-$HOME/carthing-hub/state/carpack}
DST=/var/lib/hub/pack

SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$CT")
[ -f "$SRC/pack.json" ] || exit 0
cd "$SRC" || exit 1

# covers and lyrics: compare the two lists of names (a song's files never change once written, except a lyrics
# file that gains its Vietnamese lines, so lyrics are compared by size too)
list='find c l -type f \( -name "*.jpg" -o -name "*.json" \) -exec stat -c "%n %s" {} + 2>/dev/null | LC_ALL=C sort'
here=$(sh -c "$list")
there=$("${SSH[@]}" "mkdir -p $DST/c $DST/l && cd $DST && $list") || exit 1

new=$(LC_ALL=C comm -23 <(printf '%s\n' "$here") <(printf '%s\n' "$there") | cut -d' ' -f1 | grep -v '^$')
gone=$(LC_ALL=C comm -13 <(cut -d' ' -f1 <<<"$here" | sort -u) <(cut -d' ' -f1 <<<"$there" | sort -u) | grep -v '^$')

if [ -n "$new" ]; then
  printf '%s\n' "$new" | tar cf - -T - | "${SSH[@]}" "tar xf - -C $DST" || exit 1
fi
if [ -n "$gone" ]; then
  printf '%s\n' "$gone" | "${SSH[@]}" "cd $DST && xargs rm -f"
fi
if ! cmp -s <("${SSH[@]}" "cat $DST/pack.json 2>/dev/null") pack.json; then
  "${SSH[@]}" "cat > $DST/pack.json.new && mv $DST/pack.json.new $DST/pack.json" < pack.json || exit 1
fi
echo "car pack: $(printf '%s' "$new" | grep -c .) new, $(printf '%s' "$gone" | grep -c .) removed"
