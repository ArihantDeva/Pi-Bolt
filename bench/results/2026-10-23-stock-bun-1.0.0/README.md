# Pi-Bolt 1.0.0 against Pi as released on stock Bun, Node 22 and Node 24

Pi-Bolt 1.0.0 (branch `perf/v1.0.0` at d35149cb0, built with `scripts/build-pi.sh` on the runtimes of CI run 39894603087: the
release's code and runtimes) against Pi 1.4.0 as released on npm (`@earendil-works/pi-coding-agent`, `dist/bundle/cli.js`), run
by stock Bun 1.4.4, by Node 22 and by Node 24. Same work against the same local model.

| Folder | Machine | Run |
|---|---|---|
| `linux-x64` | GitHub `ubuntu-24.04`, Intel Xeon Platinum 8573C, pinned to one CPU | `bench-stock-bun` 39945849600 (`workflow.yml`) |
| `linux-arm64` | GitHub `ubuntu-24.04-arm`, Neoverse-N2, pinned to one CPU | `bench-stock-bun` 39945849600 |
| `windows-x64` | GitHub `windows-2025`, AMD EPYC 9V74, 2 cores | `bench-stock-bun` 39945849600 |
| `macos` | Apple M5 Mac, not pinned | `run.sh`, the same steps |

Each folder has `environment.txt` (versions, how each build was obtained and checked) and `all.txt` (the tools' output):
`benchmark.py` (startup, headless, interactive; 21 runs), `long_answer.py` (60,000 characters), `long_session.py` (40
prompts), `large_write.py` (200 and 400 KB written through a tool call) and, on Linux and macOS, `tmux_load.py`.
