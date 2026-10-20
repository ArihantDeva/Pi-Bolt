# Pi-Bolt 0.9.6 on macOS against stock Bun, Node 22 and Node 24

Pi-Bolt 0.9.6 against Pi 1.3.0 on stock Bun 1.4.2 (`scripts/build-pi.sh --stable`, this repository's Pi), on Node 22 and on
Node 24 (as released on npm), with the suites of the Linux run in `../2026-10-20-linux-0.9.6`: `benchmark.py` (startup, headless,
interactive; 21 runs), `long_answer.py` (60,000 characters) and `long_session.py` (40 prompts).

- **Where:** GitHub's `macos-15` runner (Apple M1, virtual, 3 CPUs), run 39454305635, by `workflow.yml` (pushed on a scratch
  branch for the run). `environment.txt` has the versions and how each build was obtained and checked; `all.txt` the output.
- **Pi-Bolt 0.9.6** is the release's `pi-bolt-darwin-arm64.tar.xz`, checked against its SHA256SUMS.
- **Wall time on this runner:** the runner stretches the paced tools, so a 60,000-character answer took about 270 to 290 s
  of wall time instead of about 50 s. Its CPU figures are comparable; its wall times are not.
