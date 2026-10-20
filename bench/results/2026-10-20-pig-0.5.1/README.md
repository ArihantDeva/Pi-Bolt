# Pi-Bolt 0.9.6 against PiG 0.5.1

Pi-Bolt 0.9.6 against [PiG](https://github.com/MichaelKinsy/PiG) 0.5.1 (the Go port of Pi, on Pi 1.3.0), with Pi-Bolt 0.9.5 and
Pi 1.3.0 on Node 24 for context. Each folder holds the raw output of the bench tools and its `environment.txt` (versions, how
each build was obtained and checked, the machine).

| Folder | Where | Run |
|---|---|---|
| `linux-x64` | GitHub's `ubuntu-24.04` runner, one CPU pinned | workflow `bench` on branch `bench/pig-096`, run 39368383277 |
| `linux-arm64` | GitHub's `ubuntu-24.04-arm` runner, one CPU pinned | the same run |
| `windows-x64` | GitHub's `windows-2025` runner | workflow `bench-windows-pig` on branch `bench/windows-pig-096`, run 39368539963 |
| `macos-m5-local` | an Apple M5 Mac (macOS 27), not pinned, other work light | the bench tools run by hand against the release archives |
| `macos-github` | GitHub's `macos-15` runner, a shorter suite (no tmux, one streaming size) | workflow `bench` on branch `bench/pig-096-mac`, run 39377153579 |

- **Builds:**
  - Pi-Bolt 0.9.6 and 0.9.5 are their release archives; on GitHub's runners, 0.9.6 was built from tag `bolt-v0.9.6` with `scripts/build-pi.sh` (`build-pi.ps1` on Windows) on the release's runtimes, because the release had no archives yet.
  - PiG 0.5.1 is its release archive, checked against its SHA256SUMS (and on CI its sigstore bundle).
  - Node 24 runs `@earendil-works/pi-coding-agent@1.3.0` from npm.
- **Same work:** `bench/pig_verify.py` (`verify.txt`, and run by hand on the Mac) checks that every build sends the same requests, gets the same tool results, gives the same answers and writes the same files, with one exception. Pi-Bolt enables `grep` and `find` by default, so its requests carry two more tool definitions, about 2 KB each, which slightly handicaps Pi-Bolt.
- **macOS on GitHub:** GitHub's macOS runner stretches the paced tools (a 17-second answer took about 99 s), so the full suite ran out of time there: `macos-github` is the shorter suite, and the full one comes from the M5 Mac.
