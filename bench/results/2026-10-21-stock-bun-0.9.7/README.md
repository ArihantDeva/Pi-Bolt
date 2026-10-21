# Pi-Bolt 0.9.7 against Pi as released on stock Bun, Node 22 and Node 24

Pi-Bolt 0.9.7 (the release's archives, checked against its SHA256SUMS) against Pi 1.3.0 as released on npm
(`@earendil-works/pi-coding-agent`, `dist/bundle/cli.js`), run by stock Bun 1.4.2, by Node 22 and by Node 24. Same work against
the same local model. Workflow `bench-stock-bun` on branch `bench/stock-bun-097`, run 39607602702 (`workflow.yml` here).

| Folder | Runner |
|---|---|
| `linux-x64` | `ubuntu-24.04`, Intel Xeon Platinum 8370C, pinned to one CPU |
| `linux-arm64` | `ubuntu-24.04-arm`, Neoverse-N2, pinned to one CPU |
| `macos` | `macos-15`, Apple M1 (virtual), 3 CPUs, not pinned |
| `windows-x64` | `windows-2025`, AMD EPYC 9V74, 2 cores |

Each folder has `environment.txt` (versions, how each build was obtained and checked) and `all.txt` (the tools' output):
`benchmark.py` (startup, headless, interactive; 21 runs), `long_answer.py` (60,000 characters), `long_session.py` (40 prompts),
`large_write.py` (200 and 400 KB written through a tool call) and, on Linux and macOS, `tmux_load.py`.

The "Bun" column of earlier runs (such as `2026-10-20-linux-0.9.6`) was this repository's Pi on stock Bun, with Pi-Bolt's
changes to Pi's code; here it is Pi as released. GitHub's macOS runner stretches the paced tools (the long answer and tmux), so
their wall times there are not comparable; their CPU times are.
