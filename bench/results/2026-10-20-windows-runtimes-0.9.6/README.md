# Pi-Bolt 0.9.6 on Windows against stock Bun, Node 22 and Node 24

Pi-Bolt 0.9.6 against Pi 1.3.0 on stock Bun 1.4.2 (`scripts\build-pi.ps1 -Stable`, this repository's Pi), on Node 22 and on
Node 24 (as released on npm), with the suites of the Linux run in `../2026-10-20-linux-0.9.6`: `benchmark.py` (startup, headless,
interactive; 21 runs), `long_answer.py` (60,000 characters) and `long_session.py` (40 prompts). The TUI runs in a ConPTY
(`winproc.py`); memory is the working set, and "own" is the private bytes.

- **Where:** GitHub's `windows-2025` runner (AMD EPYC 9V74, 2 cores), run 39451756368, by `workflow.yml` (pushed on a scratch
  branch for the run). `environment.txt` has the versions and how each build was obtained and checked; the other files the
  output of each tool.
- **Pi-Bolt 0.9.6** is the release's `pi-bolt-win32-x64.zip`, checked against its SHA256SUMS.
