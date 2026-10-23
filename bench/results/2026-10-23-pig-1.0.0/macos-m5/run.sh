#!/bin/bash
# The bench.yml macOS steps, on this Mac: 0.9.9 release vs the 1.0.0 candidate vs PiG 0.5.1.
set -u
M=$M
cd "$M/tools" || exit 1
R=$M/results
B=(--build "rel=$M/rel/pi" --build "cand=$M/cand/pi" --build "pig=$M/pig/pig")
run() { local name=$1 out=$2; shift 2; echo "== $name $(date +%H:%M:%S) load $(sysctl -n vm.loadavg)"; "$@" >"$R/$out" 2>&1; echo "   exit $?"; }
{ sysctl -n machdep.cpu.brand_string; sw_vers; uptime; } >"$R/environment.txt"
run verify verify.txt python3 bench/pig_verify.py --build "cand=$M/cand/pi" --build "pig=$M/pig/pig" --build "rel=$M/rel/pi"
run benchmark benchmark.txt python3 bench/benchmark.py --runs 21 --warmup 3 "${B[@]}" --baseline rel --out "$R/benchmark.jsonl"
for i in 1 2 3; do run "long_answer $i" "long_answer-$i.txt" python3 bench/long_answer.py --sizes 20000,60000 "${B[@]}"; done
run tmux_load tmux_load.txt python3 bench/tmux_load.py --steps md:20000,write:50 "${B[@]}"
run idle idle.txt python3 bench/idle.py --seconds 20 --rounds 2 "${B[@]}"
run "idle 120 s" idle-120.txt python3 bench/idle.py --seconds 120 --rounds 1 "${B[@]}"
run long_transcript long_transcript.txt python3 bench/long_transcript.py --entries 0,2292,4000 --mode fullscreen,regular --rounds 2 "${B[@]}" --json "$R/long_transcript.jsonl"
run "long_transcript keys" long_transcript-keys.txt python3 bench/long_transcript.py --entries 2292 --mode fullscreen,regular --keys "${B[@]}" --json "$R/long_transcript.jsonl"
for i in 1 2; do run "long_session $i" "long_session-$i.txt" python3 bench/long_session.py --prompts 40 --every 20 "${B[@]}" --out "$R/long.jsonl"; done
echo "== done $(date +%H:%M:%S)"
