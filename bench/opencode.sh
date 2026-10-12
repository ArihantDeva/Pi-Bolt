#!/bin/sh
# Runs OpenCode 2.0 as the bench tools run Pi: Pi's arguments in, OpenCode's out, against the run's fake model.
# OPENCODE_BIN: the opencode executable (@opencode/cli). PI_CODING_AGENT_DIR: the run's Pi home (its models.json names the fake
# model's URL). --standalone: a private server in this process tree, so its CPU is counted, and a fresh one each run. Automatic
# compaction is off, so a long session sends the whole conversation, as the other builds do.
# Example: bench/benchmark.py --build "opencode=env OPENCODE_BIN=<opencode> bench/opencode.sh"
H="$PI_CODING_AGENT_DIR"
url=$(sed -n 's/.*"baseUrl": "\(http:\/\/127\.0\.0\.1:[0-9]*\/v1\)".*/\1/p' "$H/models.json" | head -n 1)
C="$H/oc/config/opencode"
mkdir -p "$C"
printf '{"provider":{"fake":{"npm":"@ai-sdk/openai-compatible","name":"Fake","options":{"baseURL":"%s","apiKey":"fake"},"models":{"fake-model":{"name":"fake-model","limit":{"context":100000000,"output":8192}}}}},"model":"fake/fake-model","autoupdate":false,"share":"disabled","compaction":{"auto":false}}' "$url" > "$C/opencode.json"
export HOME="$H/oc" XDG_CONFIG_HOME="$H/oc/config" XDG_DATA_HOME="$H/oc/data" XDG_STATE_HOME="$H/oc/state" XDG_CACHE_HOME="$H/oc/cache" PWD="$(pwd)" OPENCODE_DISABLE_AUTOUPDATE=1
case "$1" in
	--version) exec "$OPENCODE_BIN" --version ;;
	-p) shift; prompt=""; for a; do prompt="$a"; done; exec "$OPENCODE_BIN" run --standalone --auto -m fake/fake-model "$prompt" ;;
	*) exec "$OPENCODE_BIN" --standalone --auto ;;
esac
