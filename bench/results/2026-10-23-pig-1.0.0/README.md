# Pi-Bolt 1.0.0 against PiG 0.5.1 and Pi-Bolt 0.9.9

Pi-Bolt 1.0.0 (branch `perf/v1.0.0` at d35149cb0, built with `scripts/build-pi.sh` on the runtimes of CI run 39894603087: the
release's code and runtimes) against [PiG](https://github.com/MichaelKinsy/PiG) 0.5.1 (its release binaries, checked against
SHA256SUMS and their attestation) and Pi-Bolt 0.9.9 (its release archives, checked against SHA256SUMS). Same work against the
same local model: `verify.txt` in each folder is `bench/pig_verify.py`'s check of the requests, tool results, answers and files.

| Folder | Machine | Run |
|---|---|---|
| `linux-x64` | GitHub `ubuntu-24.04`, AMD EPYC 7763, pinned to one CPU | `bench` 39939443543 (`workflow.yml`) |
| `linux-arm64` | GitHub `ubuntu-24.04-arm`, Neoverse-N2, pinned to one CPU | `bench` 39939443543 |
| `windows-x64` | GitHub `windows-2025`, AMD EPYC 7763, 2 cores | `bench-windows` 39939443492 (`workflow-windows.yml`) |
| `macos-m5` | Apple M5 Mac, not pinned (a shared machine: instruction counts are the steadier figure) | `run.sh`, the macOS steps of `workflow.yml` |

Each folder has `environment.txt`, the tools' printed output (`*.txt`) and their JSONL. Tools: `benchmark.py` (startup,
headless, interactive; 21 runs), `long_answer.py` (20,000 and 60,000 characters, three rounds), `tmux_load.py`, `pauses.py`,
`idle.py` (20 s, two rounds, and 120 s), `long_transcript.py` (a resumed session of 0, 2,292 and 4,000 entries), and
`long_session.py` (40 prompts, two runs). `build "rel"` is 0.9.9, `cand` is 1.0.0, `pig` is PiG 0.5.1.

On Linux, `peak_own_mb` is the process's anonymous resident memory, sampled every 2 ms (`bench/harness.py` `PeakOwnSampler`),
the counterpart of macOS's footprint (`peak_fp_mb`): `peak_mb` (`ru_maxrss`) also counts the clean pages of the files a build
maps. `long_transcript.py` stopped early where 0.9.9 did not start a 4,000-entry session in regular mode within its deadline
(Linux) or a 2,292-entry one (macOS).
