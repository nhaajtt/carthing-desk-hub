#!/bin/bash
# Builds bnep.ko (Bluetooth networking, for the iPhone's Personal Hotspot over Bluetooth) for the Car Thing's
# kernel, on server 2, in a throwaway Debian container. Nocturne's kernel is built without CONFIG_BT_BNEP, and it
# has no module signing and no symbol versions, so a module built from the same kernel source with the same config
# and the same compiler loads. How to load and use it: carthing/bnep/README.md.
#
#   ~/carthing-tools/build-bnep.sh        # writes ~/carthing-tools/bnep.ko
set -eu
WORK=${WORK:-$HOME/kbuild}
OUT=${OUT:-$HOME/carthing-tools/bnep.ko}
KEY=${KEY:-$HOME/.ssh/carthing_ed25519}
CT=${CT:-root@10.42.1.2}
# the compiler the Car Thing's kernel was built with (CONFIG_GCC_VERSION=150200), from kernel.org's crosstool builds
GCC_URL=https://mirrors.edge.kernel.org/pub/tools/crosstool/files/bin/x86_64/15.2.0/x86_64-gcc-15.2.0-nolibc-aarch64-linux.tar.xz
GCC_SHA=a3b99f6f979ed427d43fbb9cfabfa2ca40e2f4e830dff9a37520d828ebc63e4d

mkdir -p "$WORK" "$(dirname "$OUT")"
cd "$WORK"

# the running kernel and its config, straight from the Car Thing
REL=$(ssh -i "$KEY" "$CT" uname -r)          # e.g. 7.0.2-superbird
ssh -i "$KEY" "$CT" 'zcat /proc/config.gz' > superbird.config
KVER=${REL%%-*}
grep -q '^CONFIG_GCC_VERSION=150200$' superbird.config ||
  echo "warning: the Car Thing's kernel was not built with GCC 15.2 ($(grep '^CONFIG_CC_VERSION_TEXT' superbird.config)); update GCC_URL" >&2
for off in MODVERSIONS MODULE_SIG RANDSTRUCT; do
  grep -q "^CONFIG_$off=y" superbird.config && { echo "CONFIG_$off is on in the new kernel: a module built here will not load" >&2; exit 1; }
done

# sources, checked against kernel.org's published SHA-256 list and the pinned compiler hash
TAR=linux-$KVER.tar.xz
if [ ! -d "linux-$KVER" ]; then
  [ -f "$TAR" ] || curl -fsSLo "$TAR" "https://cdn.kernel.org/pub/linux/kernel/v${KVER%%.*}.x/$TAR"
  want=$(curl -fsSL "https://cdn.kernel.org/pub/linux/kernel/v${KVER%%.*}.x/sha256sums.asc" | awk -v f="$TAR" '$2 == f {print $1}')
  [ -n "$want" ] && echo "$want  $TAR" | sha256sum -c --quiet || { echo "$TAR: checksum does not match kernel.org" >&2; exit 1; }
  tar xf "$TAR"
fi
if [ ! -d gcc-15.2.0-nolibc ]; then
  [ -f "${GCC_URL##*/}" ] || curl -fsSLO "$GCC_URL"
  echo "$GCC_SHA  ${GCC_URL##*/}" | sha256sum -c --quiet
  tar xf "${GCC_URL##*/}"
fi

cat > build-bnep.sh <<EOF
#!/bin/bash
set -e
apt-get update -qq >/dev/null && apt-get install -y -qq make gcc flex bison bc libelf-dev libssl-dev kmod >/dev/null
cd /k/linux-$KVER
X="ARCH=arm64 CROSS_COMPILE=/k/gcc-15.2.0-nolibc/aarch64-linux/bin/aarch64-linux-"
cp /k/superbird.config .config
make \$X olddefconfig >/dev/null
scripts/config --module BT_BNEP --enable BT_BNEP_MC_FILTER --enable BT_BNEP_PROTO_FILTER
make \$X olddefconfig >/dev/null
# only the BNEP lines may differ from the Car Thing's own config
diff <(grep -v "^#" /k/superbird.config | sort) <(grep -v "^#" .config | sort) || true
make \$X -j\$(nproc) modules_prepare >/dev/null
make \$X KBUILD_MODPOST_WARN=1 M=net/bluetooth/bnep modules
modinfo -F vermagic net/bluetooth/bnep/bnep.ko > /k/vermagic
EOF
docker run --rm -v "$WORK":/k debian:trixie bash /k/build-bnep.sh

magic=$(cat vermagic)
case "$magic" in
  "$REL "*) ;;
  *) echo "vermagic '$magic' does not match the Car Thing's kernel '$REL'" >&2; exit 1 ;;
esac
cat "linux-$KVER/net/bluetooth/bnep/bnep.ko" > "$OUT"
echo "$OUT: $magic"
sha256sum "$OUT"
