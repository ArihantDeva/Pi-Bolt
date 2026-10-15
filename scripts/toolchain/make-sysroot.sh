#!/usr/bin/env bash
# Builds the Linux glibc sysroot that release binaries are linked against, for this machine's architecture (x86-64 or ARM64):
# Ubuntu 20.04's root filesystem and libc (glibc 2.31), gcc-13's libstdc++ (the packages Bun's and WebKit's release images use),
# and ICU built as static libraries, so that the executable needs neither a newer glibc nor the system's ICU.
# Usage: scripts/toolchain/make-sysroot.sh [DIR]   (default: .toolchain/sysroot-glibc)   Needs docker (or sudo docker), curl, dpkg-deb.
# (In a container: the host's docker socket, mounted at /var/run/docker.sock.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SYSROOT="$(realpath -m "${1:-$ROOT/.toolchain/sysroot-glibc}")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
case "$(uname -m)" in
x86_64) ARCH=amd64 TRIPLE=x86_64-linux-gnu MIRROR=http://archive.ubuntu.com/ubuntu MARCH=-march=nehalem ;;
aarch64) ARCH=arm64 TRIPLE=aarch64-linux-gnu MIRROR=http://ports.ubuntu.com/ubuntu-ports MARCH=-march=armv8-a+crc ;;
*) echo "no sysroot for $(uname -m)" >&2; exit 1 ;;
esac
GCC_DEBS=https://github.com/oven-sh/WebKit/releases/download/gcc-13-focal-debs/gcc-13-focal-$ARCH.tar.gz
ICU_VERSION=78.3
ICU_SHA256=3a2e7a47604ba702f345878308e6fefeca612ee895cf4a5f222e7955fabfe0c0
DOCKER=docker
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

echo "==> ubuntu:20.04 root filesystem -> $SYSROOT"
rm -rf "$SYSROOT" && mkdir -p "$SYSROOT"
cid=$($DOCKER create --platform "linux/$ARCH" ubuntu:20.04 true)
$DOCKER export "$cid" | tar -x -C "$SYSROOT" --exclude='dev/*' 2>/dev/null || true
$DOCKER rm "$cid" >/dev/null

echo "==> libc runtime and headers from focal-updates"
curl -fsSL "$MIRROR/dists/focal-updates/main/binary-$ARCH/Packages.gz" -o "$WORK/updates.gz"
curl -fsSL "$MIRROR/dists/focal/main/binary-$ARCH/Packages.gz" -o "$WORK/release.gz"
gzip -dc "$WORK/updates.gz" "$WORK/release.gz" > "$WORK/Packages"
for p in libc6 libc6-dev linux-libc-dev libcrypt1 libcrypt-dev; do
	path=$(awk -v p="$p" '$1=="Package:"&&$2==p{f=1} f&&$1=="Filename:"{print $2; exit}' "$WORK/Packages")
	[ -n "$path" ] || { echo "focal has no $p" >&2; exit 1; }
	curl -fsSL "$MIRROR/$path" -o "$WORK/p.deb"
	dpkg-deb -x "$WORK/p.deb" "$SYSROOT"
done

echo "==> gcc-13 libstdc++ and libgcc"
curl -fsSL "$GCC_DEBS" -o "$WORK/gcc.tar.gz"
mkdir -p "$WORK/gcc" && tar -xzf "$WORK/gcc.tar.gz" -C "$WORK/gcc"
find "$WORK/gcc" -name '*.deb' -exec dpkg-deb -x {} "$SYSROOT" \;

echo "==> keep absolute symlinks inside the sysroot"
find "$SYSROOT" -type l | while read -r link; do
	target=$(readlink "$link")
	case "$target" in /*) ln -sfn "$SYSROOT$target" "$link" ;; esac
done
[ -e "$SYSROOT/lib/$TRIPLE/libc.so.6" ] || { mkdir -p "$SYSROOT/lib"; ln -sfn "../usr/lib/$TRIPLE" "$SYSROOT/lib/$TRIPLE"; }
[ "$ARCH" != amd64 ] || [ -e "$SYSROOT/lib64" ] || ln -sfn "usr/lib/$TRIPLE" "$SYSROOT/lib64"

echo "==> ICU $ICU_VERSION, static, built against the sysroot"
curl -fsSL "https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION}/icu4c-${ICU_VERSION}-sources.tgz" -o "$WORK/icu.tgz"
echo "$ICU_SHA256  $WORK/icu.tgz" | sha256sum -c -
tar -xzf "$WORK/icu.tgz" -C "$WORK"
CC="${CC:-clang}"; CXX="${CXX:-clang++}"
(cd "$WORK/icu/source" &&
	CC="$CC" CXX="$CXX" CFLAGS="--sysroot=$SYSROOT -Os -fPIC $MARCH" \
		CXXFLAGS="--sysroot=$SYSROOT -Os -fPIC $MARCH -stdlib=libstdc++" LDFLAGS="--sysroot=$SYSROOT -fuse-ld=lld" \
		./configure --prefix=/usr --enable-static --disable-shared --disable-tests --disable-samples > "$WORK/icu-configure.log" 2>&1 &&
	make -j"$(nproc)" > "$WORK/icu-make.log" 2>&1 &&
	make DESTDIR="$SYSROOT" install > "$WORK/icu-install.log" 2>&1) || { tail -30 "$WORK"/icu-*.log; exit 1; }
ls "$SYSROOT/usr/lib/libicuuc.a" "$SYSROOT/usr/lib/libicui18n.a" "$SYSROOT/usr/lib/libicudata.a"
echo "done: $SYSROOT"
