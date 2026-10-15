#!/usr/bin/env bash
# The installer's checks of what it downloads, against the latest release served from a local folder (PIBOLT_DOWNLOAD_BASE):
#   - the release as published installs, its signature verified;
#   - without SHA256SUMS.sig it is not installed (a signed release must carry its signature);
#   - an archive replaced together with its checksum is not installed (the signature of SHA256SUMS does not match);
#   - a PIBOLT_BIN_DIR with quotes, $(...) and backquotes stays a folder name in the line given for the shell's configuration;
#   - an update keeps the build it replaces as <name>.previous (for pi-bolt update --rollback), and the same build installed
#     again does not replace the one kept;
#   - PIBOLT_CHANNEL=beta is kept for the installation's updates (<install>/channel), and stable takes it away.
# Needs curl, python3 and gh (or a GitHub token for gh), and OpenSSL 3 for the verified case.
#
# Usage: tests/installer/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
case "$(uname -s)-$(uname -m)" in Darwin-*) NAME=pi-bolt-darwin-arm64 ;; *-aarch64) NAME=pi-bolt-linux-arm64 ;; *) NAME=pi-bolt-linux-x64 ;; esac
WORK=$(mktemp -d)
SERVER=""
trap '[ -z "$SERVER" ] || kill "$SERVER" 2>/dev/null; rm -rf "$WORK"' EXIT
status=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; status=1; }

mkdir -p "$WORK/good"
# (Tried three times: GitHub's API answers a download with an occasional HTTP 500.)
for attempt in 1 2 3; do
	gh release download --repo opensec-git/Pi-Bolt --dir "$WORK/good" --clobber --pattern SHA256SUMS --pattern SHA256SUMS.sig \
		--pattern "$NAME.tar.gz" --pattern "$NAME.tar.xz" && break
	[ "$attempt" = 3 ] && exit 1
	sleep 10
done
cp -R "$WORK/good" "$WORK/nosig" && rm "$WORK/nosig/SHA256SUMS.sig"
cp -R "$WORK/good" "$WORK/tampered"
(
	cd "$WORK/tampered"
	echo "not Pi-Bolt" >x && tar -czf "$NAME.tar.gz" x && cp "$NAME.tar.gz" "$NAME.tar.xz" && rm x
	sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
	grep -v " $NAME\.tar\." SHA256SUMS >s && sum "$NAME.tar.gz" "$NAME.tar.xz" >>s && mv s SHA256SUMS
)

port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$WORK" >/dev/null 2>&1 &
SERVER=$!
for _ in $(seq 50); do curl -fs "http://127.0.0.1:$port/" >/dev/null && break; sleep 0.1; done

# install CASE [ENV...]: runs the installer against $WORK/CASE in a home of its own; prints its output.
install() {
	local case=$1
	shift
	rm -rf "${WORK:?}/home"
	mkdir -p "$WORK/home"
	env HOME="$WORK/home" SHELL=/bin/sh PIBOLT_DOWNLOAD_BASE="http://127.0.0.1:$port/$case" PIBOLT_EXTENSIONS=no PIBOLT_NO_START=1 \
		PIBOLT_YES=1 PIBOLT_INSTALL="$WORK/home/inst" PIBOLT_BIN_DIR="$WORK/home/bin" "$@" sh "$ROOT/install.sh" </dev/null 2>&1 || true
}
installed() { [ -x "$WORK/home/inst/$NAME/pi" ]; }
# install_again CASE [ENV...]: the same, over what the last run installed.
install_again() {
	local case=$1
	shift
	env HOME="$WORK/home" SHELL=/bin/sh PIBOLT_DOWNLOAD_BASE="http://127.0.0.1:$port/$case" PIBOLT_EXTENSIONS=no PIBOLT_NO_START=1 \
		PIBOLT_YES=1 PIBOLT_INSTALL="$WORK/home/inst" PIBOLT_BIN_DIR="$WORK/home/bin" "$@" sh "$ROOT/install.sh" </dev/null 2>&1 || true
}

out=$(install good)
if installed && grep -q "signature verified" <<<"$out"; then pass "the release installs, signature verified"; else
	fail "the release installs, signature verified"; printf '%s\n' "$out"; fi

out=$(install nosig)
if ! installed && grep -q "could not download the release's signature" <<<"$out"; then pass "no signature: not installed"; else
	fail "no signature: not installed"; printf '%s\n' "$out"; fi

out=$(install tampered)
if ! installed && grep -q "signature does not verify" <<<"$out"; then pass "replaced archive and checksum: not installed"; else
	fail "replaced archive and checksum: not installed"; printf '%s\n' "$out"; fi

bin="$WORK/home/b\"\$(touch $WORK/pwned)\`touch $WORK/pwned\`"
out=$(install good PIBOLT_BIN_DIR="$bin")
line=$(sed -n 's/^  export PATH=/export PATH=/p' <<<"$out" | head -1)
if [ -n "$line" ]; then
	sh -c "$line" && first=$(sh -c "$line; printf '%s' \"\$PATH\"" | cut -d: -f1)
	if [ ! -e "$WORK/pwned" ] && [ "${first:-}" = "$bin" ]; then pass "PIBOLT_BIN_DIR stays a folder name"; else
		fail "PIBOLT_BIN_DIR stays a folder name"; printf '%s\n' "$line"; fi
else
	fail "PIBOLT_BIN_DIR stays a folder name (no PATH line)"; printf '%s\n' "$out"
fi

inst="$WORK/home/inst"
out=$(install good)
if [ ! -e "$inst/$NAME.previous" ]; then pass "a first install keeps no previous build"; else fail "a first install keeps no previous build"; fi
printf 'an older build\n' >>"$inst/$NAME/pi-bolt.txt"
out=$(install_again good)
if installed && grep -q "an older build" "$inst/$NAME.previous/pi-bolt.txt" 2>/dev/null &&
	! grep -q "an older build" "$inst/$NAME/pi-bolt.txt"; then pass "an update keeps the build it replaces as .previous"; else
	fail "an update keeps the build it replaces as .previous"; printf '%s\n' "$out"; fi
out=$(install_again good)
if grep -q "an older build" "$inst/$NAME.previous/pi-bolt.txt" 2>/dev/null; then
	pass "the same build installed again leaves the previous one"; else
	fail "the same build installed again leaves the previous one"; printf '%s\n' "$out"; fi

version=$(head -n 1 "$WORK/good/SHA256SUMS" | sed 's/^# pi-bolt //')
out=$(install_again good PIBOLT_CHANNEL=beta PIBOLT_VERSION="bolt-v$version")
if [ "$(cat "$inst/channel" 2>/dev/null)" = beta ]; then pass "PIBOLT_CHANNEL=beta is kept for updates"; else
	fail "PIBOLT_CHANNEL=beta is kept for updates"; printf '%s\n' "$out"; fi
out=$(install_again good PIBOLT_CHANNEL=stable)
if [ ! -e "$inst/channel" ]; then pass "PIBOLT_CHANNEL=stable takes it away"; else fail "PIBOLT_CHANNEL=stable takes it away"; fi
out=$(install_again good PIBOLT_CHANNEL=nightly)
if grep -q "PIBOLT_CHANNEL must be stable or beta" <<<"$out"; then pass "another channel is refused"; else
	fail "another channel is refused"; printf '%s\n' "$out"; fi
exit $status
