#!/bin/bash
# The bench-stock-bun steps on this Mac: Pi-Bolt 1.0.0 against Pi 1.4.0 as released, run by stock Bun 1.4.4, Node 22 and Node 24.
set -u
D=$D
T=$T
CLI=$D/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
cd "$T/tools" || exit 1
R=$D/results; mkdir -p "$R"
B=(--build "pi-bolt=$T/cand/pi" --build "bun=$D/bun/bun-darwin-aarch64/bun $CLI" --build "node22=$D/node22/bin/node $CLI" --build "node24=$D/node24/bin/node $CLI")
{
  echo "machine: $(sysctl -n machdep.cpu.brand_string), $(sw_vers -productVersion), not pinned"
  echo "pi-bolt: perf/v1.0.0 d35149cb0 by scripts/build-pi.sh on the runtime of run 39894603087 (runtime-darwin-arm64)"
  echo "bun: Pi 1.4.0 as released on npm, run by stock Bun $($D/bun/bun-darwin-aarch64/bun --version) (bun-darwin-aarch64.zip, checked against SHASUMS256.txt)"
  echo "node22: Pi 1.4.0 as released on npm, on Node $($D/node22/bin/node --version) (nodejs.org, checked against SHASUMS256.txt)"
  echo "node24: Pi 1.4.0 as released on npm, on Node $($D/node24/bin/node --version) (nodejs.org, checked against SHASUMS256.txt)"
} >"$R/environment.txt"
run() { local name=$1; shift; echo "## $name"; echo "== $name $(date +%H:%M:%S) load $(sysctl -n vm.loadavg)" >&2; "$@" 2>&1; }
{
  run benchmark python3 bench/benchmark.py --runs 21 --warmup 3 --scenarios startup,headless,interactive "${B[@]}" --baseline node24
  run long_answer python3 bench/long_answer.py --sizes 60000 "${B[@]}"
  run long_session python3 bench/long_session.py --prompts 40 --every 20 "${B[@]}"
  run large_write python3 bench/large_write.py --sizes 200,400 "${B[@]}"
  run tmux_load python3 bench/tmux_load.py "${B[@]}"
} >"$R/all.txt"
echo "== done $(date +%H:%M:%S)" >&2
