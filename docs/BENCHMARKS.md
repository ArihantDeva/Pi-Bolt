# Benchmarks

Pi-Bolt compared with the same Pi release on stock Bun and on Node.js. Every figure comes from the tools in
[`bench/`](../bench), and the raw results are in [`bench/results/`](../bench/results). The charts are drawn from those files by
[`bench/report.py`](../bench/report.py).

**Versions.** Pi-Bolt 0.8.5 (Pi 1.1.0), against Pi 1.1.0 as released on stock Bun 1.4.2 and on Node, every build installed from
its release archive; [against PiG and oh-my-pi](#against-pig-and-oh-my-pi) in the same runs. [With a real model](#with-a-real-model) is an earlier measurement, of Pi-Bolt 0.6.1.

**These are measurements, not guarantees.** Each set of results comes from one machine: an AMD EPYC 7B13 server for Linux and an
M5 MacBook Air for macOS. On other hardware the milliseconds will differ, and so can the load, the terminal and the disk. What
carries over is the comparison, because every run interleaves the runtimes on the same machine: Pi-Bolt starts three times
sooner than Pi on Bun and uses about a quarter of its CPU over an interactive session. The ratio varies by scenario: see
each table.

- [0.7.3 against 0.7.2](#073-against-072)
- [Results](#results)
- [macOS on Apple silicon](#macos-on-apple-silicon)
- [Linux on ARM64](#linux-on-arm64)
- [Windows x64](#windows-x64)
- [Against PiG and oh-my-pi](#against-pig-and-oh-my-pi)
- [Against OpenCode 2.0](#against-opencode-20)
- [With a real model](#with-a-real-model)
- [Setup and method](#setup-and-method)
- [In a real terminal (tmux)](#in-a-real-terminal-tmux)
  - [What Pi writes to the terminal](#what-pi-writes-to-the-terminal)
- [Long answers and large files](#long-answers-and-large-files)
- [Plugins](#plugins)
- [Questions](#questions)
  - [Why is a run-time plugin's loop slow on the default build?](#why-is-a-run-time-plugins-loop-slow-on-the-default-build)
- [Reproduce](#reproduce)
- [Correctness](#correctness)

## 0.7.3 against 0.7.2

What 0.7.3 changed, measured against 0.7.2 on the same machines, both installed from their release archives and interleaved.
Raw data and method: [`bench/results/2026-10-10-0.7.3-vs-0.7.2`](../bench/results/2026-10-10-0.7.3-vs-0.7.2). Medians;
"own memory" is the physical footprint on macOS and private dirty memory on Linux.

| Scenario | Metric | macOS 0.7.2 | macOS 0.7.3 | Linux 0.7.2 | Linux 0.7.3 |
|---|---|---:|---:|---:|---:|
| `pi -p`, `pi-bin` not in memory | wall | 177 ms | **64 ms** | | |
| `pi --version` | CPU | 7 ms | 7 ms | 16 ms | **15 ms** |
| | peak memory | 30 MB | 30 MB | 80 MB | **66 MB** |
| `pi -p` (one prompt, 5 turns) | CPU | 30 ms | 30 ms | 97 ms | **90 ms** |
| | peak footprint / peak memory | 32 MB | **29 MB** | 144 MB | **127 MB** |
| Interactive, 5 prompts | CPU | 131 ms | **125 ms** | 345 ms | **326 ms** |
| | peak footprint / peak memory | 51 MB | **46 MB** | 172 MB | **154 MB** |
| Long session, CPU per prompt | at prompt 70 / 50 | 73 ms | **63 ms** | 252 ms | **231 ms** |
| | own memory at 70 / 50 | 47-70 MB | **45-48 MB** | 115-157 MB | 129-160 MB |
| Streaming in tmux | CPU | 592 ms | **565 ms** | 408 ms | **363 ms** |
| Idle at the prompt | CPU per second | 1.0 ms | 1.1 ms | 0.56 ms | **0.30 ms** |
| 32 MB of command output, a line at a time | CPU | 2.0 s | **0.26 s** | 5.1 s | **1.7 s** |
| | peak memory | 104 MB | **56 MB** | 202 MB | **128 MB** |

Long-session memory moves with when the collector runs more than with the build: on Linux three runs of each gave 115-157 MB
for 0.7.2 and 129-160 MB for 0.7.3 at prompt 50, and mostly lower for 0.7.3 earlier in the session. In the 600-prompt soak of one RPC
session (`bench/stress.py`), the floor of memory stays flat on both platforms with 0.7.3 (macOS 24-25 MB; Linux 104-105 MB
resident), where 0.7.2's rose by 5 MB per 100 prompts on Linux (143-155 MB over 300 prompts).

## Results

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/bench-speed-dark.svg">
  <img alt="Time: launch to interactive, pi --version, one prompt, and time per prompt in a long session, for Pi-Bolt, Bun and Node" src="images/bench-speed-light.svg">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/bench-cpu-dark.svg">
  <img alt="CPU time of an interactive session, one prompt, pi --version, and per prompt in a long session" src="images/bench-cpu-light.svg">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/bench-memory-dark.svg">
  <img alt="Peak memory, own memory in tmux and after a long session, and CPU while replies stream" src="images/bench-memory-light.svg">
</picture>

Pi-Bolt 0.8.5 on Linux (AMD EPYC 7B13, pinned to four cores), against Pi 1.1.0 as released on stock Bun 1.4.2 and on Node 24.
Medians of 21 runs of each scenario (after 3 warm-up runs), 3 long sessions and 5 tmux rounds per build; raw data in
[`bench/results/2026-10-12-linux-x64-0.8.5`](../bench/results/2026-10-12-linux-x64-0.8.5), drawn by `bench/report.py`.

#### Time

|  | Pi-Bolt 0.8.5 | Pi on Bun 1.4.2 | Pi on Node 24 |
|---|---:|---:|---:|
| Launch to interactive (TUI) | 38 ms | 116 ms | 296 ms |
| pi --version | 11 ms | 72 ms | 222 ms |
| pi -p: one prompt, 4 tool calls | 60 ms | 154 ms | 390 ms |
| Time per prompt, 4.2M-token session | 435 ms | 691 ms | 841 ms |
| Launch to interactive (TUI), default theme | 37 ms | 112 ms | 295 ms |

#### CPU

|  | Pi-Bolt 0.8.5 | Pi on Bun 1.4.2 | Pi on Node 24 |
|---|---:|---:|---:|
| Interactive session: 5 prompts | 193 ms | 746 ms | 1,093 ms |
| pi -p: one prompt | 61 ms | 283 ms | 550 ms |
| pi --version | 11 ms | 131 ms | 281 ms |
| Per prompt, 4.2M-token session | 180 ms | 488 ms | 685 ms |

#### Memory and streaming

|  | Pi-Bolt 0.8.5 | Pi on Bun 1.4.2 | Pi on Node 24 |
|---|---:|---:|---:|
| Peak memory, interactive session | 150 MB | 217 MB | 213 MB |
| Own memory, tmux session | 22 MB | 84 MB | 185 MB |
| Own memory, end of 4.2M-token session | 134 MB | 253 MB | 536 MB |
| Streaming replies (tmux), CPU | 204 ms | 382 ms | 475 ms |

## macOS on Apple silicon

The same tools on an Apple M5 MacBook Air (10 cores, 16 GB, macOS 27.0.1). macOS cannot pin processes to cores, so runs are
interleaved. "Own memory" and "peak footprint" are the physical footprint (what Activity Monitor shows), the closest measure to
private dirty pages on Linux; "peak memory" is the resident peak, which also counts clean pages of the executable and freed
memory the kernel may take back. The MacBook Air has no fan, so differences under about 10% are within its noise.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/darwin-arm64/bench-hero-dark.svg">
  <img alt="macOS, Pi-Bolt 0.8.5 vs Pi on Bun 1.4.2 vs Pi on Node 26: ready to type 41 / 100 / 348 ms; CPU per session 139 / 561 / 937 ms; CPU while streaming 455 / 720 / 759 ms; memory after a long session 38 / 92 / 1,581 MB" src="images/darwin-arm64/bench-hero-light.svg">
</picture>

Pi-Bolt 0.8.5 against Pi 1.1.0 as released on Bun 1.4.2 and on Node 26.11 (21 runs, 3 long sessions and 5 tmux rounds per build;
raw data in [`bench/results/2026-10-12-darwin-arm64-0.8.5`](../bench/results/2026-10-12-darwin-arm64-0.8.5)):

#### Time

|  | Pi-Bolt 0.8.5 | Pi on Bun 1.4.2 | Pi on Node 26 |
|---|---:|---:|---:|
| Launch to interactive (TUI) | 41 ms | 100 ms | 348 ms |
| pi --version | 19 ms | 56 ms | 284 ms |
| pi -p: one prompt, 4 tool calls | 55 ms | 115 ms | 400 ms |
| Time per prompt, 4.2M-token session | 330 ms | 507 ms | 629 ms |
| Launch to interactive (TUI), default theme | 40 ms | 99 ms | 346 ms |

#### CPU

|  | Pi-Bolt 0.8.5 | Pi on Bun 1.4.2 | Pi on Node 26 |
|---|---:|---:|---:|
| Interactive session: 5 prompts | 139 ms | 561 ms | 937 ms |
| pi -p: one prompt | 49 ms | 221 ms | 512 ms |
| pi --version | 13 ms | 93 ms | 305 ms |
| Per prompt, 4.2M-token session | 113 ms | 329 ms | 537 ms |

#### Memory and streaming

|  | Pi-Bolt 0.8.5 | Pi on Bun 1.4.2 | Pi on Node 26 |
|---|---:|---:|---:|
| Peak memory, interactive session | 94 MB | 209 MB | 230 MB |
| Own memory, tmux session | 24 MB | 65 MB | 162 MB |
| Own memory, end of 4.2M-token session | 38 MB | 92 MB | 1,581 MB |
| Streaming replies (tmux), CPU | 455 ms | 720 ms | 759 ms |

**What macOS adds at launch.** `pi` is a small launcher: it starts `pi-bin`, the Pi-Bolt executable, in the same process, and
forks the helper that starts the programs Pi runs ([ARCHITECTURE.md](ARCHITECTURE.md#the-macos-arm64-port)). The figures are of the
release builds, launcher included. The helper adds 0.3 ms to `pi -p` (1%; nothing to `pi --version`, which starts nothing), and
each program Pi starts takes 1.4 ms more to start and be waited for (`spawnSync` of `/usr/bin/true`: 2.1 ms against 0.7). None of
the scenarios above starts a program. The programs' CPU time is not counted in Pi's on macOS (`wait4` counts a process's
children; the programs are the helper's).

## Linux on ARM64

Pi-Bolt's linux-arm64 build (Pi 1.2.0, the code for ARMv8.0 that is released) against Pi 1.2.0 on stock Bun 1.4.2 and on Node 24,
in Docker Desktop's Linux VM on an Apple M5 (arm64, 4 KB pages), pinned to four of its cores. Medians of 15 runs of each scenario
(after 3 warm-up runs) and of 4 tmux rounds; raw data in
[`bench/results/2026-10-15-linux-arm64-0.8.8`](../bench/results/2026-10-15-linux-arm64-0.8.8).

#### Time

|  | Pi-Bolt | Pi on Bun 1.4.2 | Pi on Node 24 |
|---|---:|---:|---:|
| Launch to interactive (TUI) | 29 ms | 45 ms | 114 ms |
| pi --version | 5 ms | 10 ms | 83 ms |
| pi -p: one prompt, 4 tool calls | 27 ms | 52 ms | 142 ms |
| Launch to interactive (TUI), default theme | 23 ms | 46 ms | 115 ms |

#### CPU

|  | Pi-Bolt | Pi on Bun 1.4.2 | Pi on Node 24 |
|---|---:|---:|---:|
| Interactive session: 5 prompts | 115 ms | 316 ms | 401 ms |
| pi -p: one prompt | 27 ms | 86 ms | 210 ms |
| pi --version | 5 ms | 11 ms | 95 ms |

#### Memory and streaming

|  | Pi-Bolt | Pi on Bun 1.4.2 | Pi on Node 24 |
|---|---:|---:|---:|
| Peak memory, interactive session | 129 MB | 157 MB | 179 MB |
| Own memory, tmux session | 37 MB | 75 MB | 79 MB |
| Streaming replies (tmux), CPU | 627 ms | 800 ms | 849 ms |
| Launch to interactive in tmux | 64 ms | 72 ms | 141 ms |

## Windows x64

Pi-Bolt 0.8.5 against 0.8.0 on the same laptop (on battery, best performance; both from their release archives; medians of 21
runs and of 3 long sessions, means of two rounds for long answers and files):

| | Pi-Bolt 0.8.5 | Pi-Bolt 0.8.0 |
|---|---:|---:|
| Writing a 200 KB file through a tool call | **0.5 s** | 0.7 s |
| CPU, streaming a 60,000-character answer | **6.9 s** | 7.0 s |
| Private working set, end of 4.2M-token session | **122 MB** | 142 MB |
| Private working set, TUI streaming in a ConPTY | **32 MB** | 32 MB |
| CPU, interactive session (5 prompts) | **278 ms** | 318 ms |
| CPU, `pi -p` | **92 ms** | 100 ms |
| Launch to interactive (TUI) | 105 ms | 105 ms |

The full suite (`bench\run-suite.ps1`) on Windows 11 25H2 (26200) on an Intel Core i5-1335U laptop (16 GB, on AC, best
performance, Defender real-time protection on): Pi-Bolt 0.8.0 from `1d373d18b` (Pi 1.1.0; the runtime `8bcf03bc0` with ThinLTO and
Control Flow Guard, Pi compiled ahead of time for this CPU, JIT off, the prebuilt heap laid out by the Pi 1.1.0 profile), Pi
1.1.0 as released on stock Bun 1.4.2, and Pi 1.1.0's bundle on Node 22.23.3 and Node 24.21.0. Medians of 11 runs (2 warm-up),
4 long sessions of 75 prompts, 5 streaming rounds; streaming runs in a ConPTY rather than tmux (`bench\conpty_check.py`: ConPTY
passes frames on at about 16 ms, which is the floor of the frame times). Raw data and charts:
[`bench/results/2026-10-10-windows-0.8.0`](../bench/results/2026-10-10-windows-0.8.0).

| | Pi-Bolt 0.8.0 | Pi 1.1.0 on Bun 1.4.2 | Node 22 | Node 24 |
|---|---:|---:|---:|---:|
| Launch to interactive (TUI) | **92 ms** | 177 ms | 345 ms | 311 ms |
| `pi --version` | **35 ms** | 98 ms | 242 ms | 219 ms |
| `pi -p`: one prompt, 4 tool calls | **113 ms** | 203 ms | 438 ms | 383 ms |
| Time per prompt, 4.2M-token session | **400 ms** | 506 ms | 816 ms | 794 ms |
| CPU, interactive session (5 prompts) | **291 ms** | 805 ms | 1,206 ms | 1,125 ms |
| CPU, `pi -p` | **92 ms** | 329 ms | 582 ms | 544 ms |
| CPU, `pi --version` | **17 ms** | 133 ms | 277 ms | 268 ms |
| CPU per prompt, 4.2M-token session | **166 ms** | 298 ms | 684 ms | 634 ms |
| Peak working set, interactive session | **95 MB** | 164 MB | 165 MB | 178 MB |
| Peak private working set, interactive session | **56 MB** | 126 MB | 132 MB | 138 MB |
| Peak private bytes (commit), interactive session | **113 MB** | 345 MB | 176 MB | 197 MB |
| Private working set, TUI streaming in a ConPTY | **32 MB** | 97 MB | 105 MB | 60 MB |
| Private working set, end of 4.2M-token session | **159 MB** | 248 MB | 391 MB | 413 MB |
| Private bytes, end of 4.2M-token session | **245 MB** | 465 MB | 437 MB | 467 MB |
| CPU, streaming replies (ConPTY) | **840 ms** | 982 ms | 1,468 ms | 1,285 ms |
| Frame time p99, streaming replies | **17 ms** | 17 ms | 20 ms | 19 ms |
| Frame time p99 / longest stall, 50 KB file written | **18 / 107 ms** | 59 / 3,612 ms | 75 / 2,727 ms | 64 / 858 ms |
| Frame time p99 / longest stall, 200 KB file written | **18 / 63 ms** | 154 / 43,934 ms | 302 / 57,962 ms | 71 / 46,595 ms |
| GC pause p99, 20,000-char answer / longest GC pause | 2.9 / 6.3 ms | 4.3 / 11 ms | **1.6 / 3.6 ms** | 1.6 / 8.4 ms |

Pi-Bolt is the fastest and uses the least memory in every row but the garbage collector's pauses, where Node is shorter (its
p99 by about a millisecond, its longest pause by 2.7 ms).

These come from memory committed on demand, the prebuilt heap laid out in first-use order, and the runtime's code laid out in
the order it runs ([WINDOWS.md](WINDOWS.md)). Each 50 KB and 200 KB step ends with a `bash` tool call. The only `bash.exe` on
this machine is the WSL launcher with no distribution installed, which takes about 0.1 s to start and fail. That is Pi-Bolt's
longest stall of the 50 KB step, and every build pays it.

Plugins: the example plugin's loop takes 41 ms compiled into the executable. Loaded at run time it takes 756 ms with the JIT off,
and 32 ms in the build with the JIT on, as on Bun (32 ms).

**What an executable costs Windows when it is not running.** Windows charges an image's uninitialized sections to the system's
commit for as long as it keeps the image cached, after the process has exited (process memory does not show it;
[WINDOWS.md](WINDOWS.md#what-was-measured)). `bench/image_commit.py`, medians of 5: Pi on Bun 1 MB; Pi-Bolt 33 MB (the 32 MB of the
region that has to be in the image); before that was fixed, 1,029 MB.


## Against PiG and oh-my-pi

The same runs as above also measure two other fast builds of Pi: [PiG](https://github.com/MichaelKinsy/PiG) 0.4.1
(`@pi-in-go/pig`), the Go port of Pi, based on Pi 1.0.3, and [oh-my-pi](https://github.com/can1357/oh-my-pi) 18.8.7 (`omp`), a
fork of Pi that runs on Bun. All five builds run interleaved, on the same cores; the tables in the
[README](../README.md#benchmarks) take the medians of 21 runs (`bench/benchmark.py`), the mean of two rounds for long answers and
large files, and the medians of the long sessions (75 prompts, three each) and the tmux rounds. PiG reads its own names for Pi's
settings (`PIG_HOME`, `PIG_CODING_AGENT_DIR`, `PIG_OFFLINE`) and oh-my-pi reads `models.yml`; `bench/harness.py` gives both the
same local fake model as the others.

oh-my-pi compacts a long conversation on its own: by prompt 25 it sends 0.5 MB where the others send 5.6 MB, and it stops
answering the scripted session after that, so it is left out of the long session. Raw data: as above,
[`bench/results/2026-10-12-linux-x64-0.8.5`](../bench/results/2026-10-12-linux-x64-0.8.5) and
[`bench/results/2026-10-12-darwin-arm64-0.8.5`](../bench/results/2026-10-12-darwin-arm64-0.8.5). oh-my-pi runs with
`OMP_SKIP_SETUP=1`, which skips the setup screen it shows on a first start.

## Against OpenCode 2.0

[OpenCode](https://github.com/anomalyco/opencode) 2.0.27 (`@opencode/cli`, its release binary for each platform), against
Pi-Bolt 0.8.5 in a run of its own on the same machines, with the same tools and the same local model. `bench/opencode.sh` turns
the tools' Pi arguments into OpenCode's and writes its configuration: an OpenAI-compatible provider pointing at the local model,
and automatic compaction off, so that a long session sends the whole conversation as the others do. OpenCode runs with
`--standalone`, a server of its own started by the process, so that the server's CPU is counted (`wait4` includes it) and each run
starts fresh; its memory figures are those of the process started, without the server's. OpenCode's read and write tools take
the same `path` argument as Pi's, so the scripted model does the same work for both. OpenCode opens its command menu on `/`, so the
harness waits for it before the Enter of `/quit`.

| | macOS: Pi-Bolt | macOS: OpenCode | Linux: Pi-Bolt | Linux: OpenCode |
|---|---:|---:|---:|---:|
| Ready to type | **41 ms** | 1,489 ms | **39 ms** | 1,687 ms |
| `pi -p`: one prompt, 4 tool calls | **55 ms** | 738 ms | **61 ms** | 1,153 ms |
| CPU, `pi -p` | **49 ms** | 1,548 ms | **62 ms** | 2,220 ms |
| CPU, interactive session (5 prompts) | **133 ms** | 6,493 ms | **192 ms** | 8,593 ms |
| Peak memory, interactive session | **94 MB** | 443 MB | **149 MB** | 408 MB |
| CPU per prompt, long session, prompt 25 | **34 ms** | 372 ms | **49 ms** | 475 ms |
| Time per prompt, long session, prompt 75 | **323 ms** | 1,454 ms | **426 ms** | 1,902 ms |
| CPU per prompt, long session, prompt 75 | **108 ms** | 480 ms | **177 ms** | 679 ms |
| Own memory, long session, prompt 75 | **38 MB** | 260 MB | **117 MB** | 273 MB |
| Writing a 200 KB file through a tool call | **0.4 s** | 1.7 s | **0.6 s** | 2.4 s |
| CPU, streaming a 60,000-character answer | **6.3 s** | 13.6 s | **2.6 s** | 8.6 s |

Medians of 21 runs and of 3 long sessions of 75 prompts, means of two rounds for long answers and files. OpenCode's own cost per
prompt is high from the start (about 0.4 s of CPU) and grows slowly with the conversation, so the gap narrows from about ten
times at prompt 25 to about four at prompt 75; its requests are also larger (19.1 MB at prompt 75 against Pi's 16.9 MB). In tmux
OpenCode did not finish all of its answers on either machine, so it has no tmux figures. Raw data:
[`bench/results/2026-10-12-linux-x64-opencode-2.0`](../bench/results/2026-10-12-linux-x64-opencode-2.0) and
[`bench/results/2026-10-12-darwin-arm64-opencode-2.0`](../bench/results/2026-10-12-darwin-arm64-opencode-2.0).

## With a real model

The tables above use a local scripted model, which answers instantly and the same way every time, so they measure Pi and its
runtime alone. These use a hosted model over the internet, with thinking at its highest setting, as in daily use. They were
taken with Pi-Bolt 0.6.1 against Pi 1.0.0 as released, and have not been taken again since.
- Pi loads the provider's extension, in its Bun build for Pi-Bolt and Bun and its Node build for Node.
- Every runtime gets the same prompts and a fresh copy of the same project, and the runtimes take turns.
- CPU and memory are those of Pi's own process.

A real model's answers differ from run to run in length and in the tools they call, so some figures are also given per 1,000
characters streamed (answer and thinking). With a real model, a turn's wall time is almost all the model's (its thinking and the
network), and it varies by several seconds from one request to the next.

### Linux

**A prompt with tools, `pi -p`:** "Use ls to list this folder (and src), read README.md, then tell me its first heading and how
many .ts files there are." 10 rounds per runtime.

| | Pi-Bolt | Bun 1.4.2 | Node 22 | Node 24 |
|---|---:|---:|---:|---:|
| Correct answers | 10/10 | 10/10 | 10/10 | 10/10 |
| Wall time, median | 7.96 s | 7.96 s | 8.17 s | 7.48 s |
| Wall time, fastest / slowest | 6.0 / 12.0 s | 6.3 / 9.4 s | 6.5 / 10.7 s | 6.0 / 10.2 s |
| **Pi's CPU, median** | **0.20 s** | 0.49 s | 0.77 s | 0.76 s |
| Pi's CPU, range | 0.17–0.23 s | 0.45–0.52 s | 0.69–0.89 s | 0.73–0.79 s |
| Peak memory, median | **124 MB** | 131 MB | 126 MB | 135 MB |

- **Wall time:** no runtime is faster or slower. In a permutation test, differences in median as large as these came out by
  chance 65–97% of the time: they are the model's variation.
- **CPU:** the difference does not overlap. Pi-Bolt's slowest run used less than Bun's fastest.

**A long answer, `pi -p`:** about 2,500 words of Markdown with three TypeScript code blocks, answered in the chat. One run per runtime.

| | Pi-Bolt | Bun 1.4.2 | Node 22 | Node 24 |
|---|---:|---:|---:|---:|
| Answer | 19,803 characters | 20,116 characters | 19,103 characters | 20,305 characters |
| Wall time | 51 s | 53 s | 40 s | 44 s |
| **Pi's CPU** | **0.47 s** | 0.91 s | 1.06 s | 1.06 s |
| Peak memory | **124 MB** | 129 MB | 125 MB | 137 MB |

**The interactive TUI in tmux:** a 160×48 pane, "read README.md and summarize it in two sentences". One run per runtime.

| | Pi-Bolt | Bun 1.4.2 | Node 22 | Node 24 |
|---|---:|---:|---:|---:|
| Time to interactive | **88 ms** | 192 ms | 389 ms | 388 ms |
| Answer on screen after | 5.2 s | 6.5 s | 6.8 s | 5.4 s |
| **Pi's CPU, launch to answer** | **0.20 s** | 0.64 s | 0.94 s | 0.89 s |

All answers correct; no errors on screen; `/quit` exited with 0 everywhere.

### macOS

On the M5, against Pi 1.0.0 as released on Bun 1.4.2 and on Node 26. Two rounds per runtime.

**A long answer, `pi -p`:** a technical article of about 1,500 words with headings, a table and two code blocks, without tools.

| | Pi-Bolt | Bun 1.4.2 | Node 26 |
|---|---:|---:|---:|
| Characters streamed (answer and thinking), the two runs | 31,478 / 23,748 | 20,004 / 15,294 | 20,744 / 23,981 |
| **Pi's CPU per 1,000 characters** | **19.1 / 18.7 ms** | 76.6 / 36.3 ms | 47.1 / 39.1 ms |
| Pi's CPU | **600 / 443 ms** | 1,532 / 555 ms | 978 / 938 ms |
| Peak footprint | **29 / 29 MB** | 161 / 75 MB | 115 / 110 MB |

**A long session in the fullscreen TUI:** five prompts in one session.
- In the first four, the model reads one of four large Pi source files (140, 239, 63 and 47 KB) and explains it in about 600 words.
- In the fifth, it writes a design review of all four, about 1,000 words.
- Each session took 11 to 22 tool calls, and the context grew to between 82,000 and 141,000 tokens.

| | Pi-Bolt | Bun 1.4.2 | Node 26 |
|---|---:|---:|---:|
| Time to interactive, with the provider's extension | **67 / 72 ms** | 96 / 95 ms | 222 / 235 ms |
| Characters streamed, the two sessions | 74,602 / 62,691 | 61,840 / 64,547 | 68,458 / 61,331 |
| **Pi's CPU, whole session** | **5.6 / 4.3 s** | 11.5 / 8.9 s | 10.1 / 8.0 s |
| Pi's CPU per 1,000 characters | **74 / 68 ms** | 183 / 136 ms | 142 / 125 ms |
| Own memory after the last prompt | **38 / 33 MB** | 105 / 97 MB | 163 / 162 MB |
| Peak footprint | **51 / 45 MB** | not recorded / 155 MB | 166 / 163 MB |

Every prompt ended normally on every runtime. Bun's first session did not exit in time for its peak to be read.

The user waits the same on every runtime: the model sets the pace. Pi-Bolt does that waiting with:
- 40–50% of the CPU of Pi on Bun and a quarter to a half of Node's;
- a third of Bun's memory, and less than a quarter of Node's.

The measurements are in [`bench/results/2026-10-04-darwin-arm64-0.6.1-real-model`](../bench/results/2026-10-04-darwin-arm64-0.6.1-real-model).

## Setup and method

| | |
|---|---|
| Pi | 1.1.0 (`v1.1.0`) |
| Linux machine | AMD EPYC 7B13 (Zen 3), Linux 7.0, every run pinned to the same 4 cores (the least busy of a shared VM) |
| macOS machine | Apple M5 MacBook Air, macOS 27.0.1, not pinned |
| **Pi-Bolt 0.8.5** | `pi-bolt-linux-x64` and `pi-bolt-darwin-arm64` from the release: JIT off |
| **PiG 0.4.1**, **oh-my-pi 18.8.7** | their release binaries for each platform (`pig`, `omp`) |
| **Bun 1.4.2** | Pi 1.1.0 as released (`scripts/prepare-pi.sh --tag v1.1.0`), built with `scripts/build-pi.sh --stable`: Pi's own `bun build --compile` command plus `--bytecode` |
| **Node 24.21** (Linux), **Node 26.11** (macOS) | Pi 1.1.0 as released: its npm bundle (`dist/bundle/cli.js`, with Node's compile cache) |

**The model.** A local server ([`bench/fake_model.py`](../bench/fake_model.py)) speaks the OpenAI chat-completions protocol and
streams a scripted conversation: for each prompt, four `read` tool calls on Pi source files, then an answer. There is no network
and no model latency, so the figures measure Pi and its runtime.

**Isolation.**

- Each run gets a fresh Pi home with only that model configured, and an environment cleared of `BUN_*`, `NODE_*` and `PI_*`.
- Runs are interleaved round-robin across builds, so background load affects all of them alike.

**Metrics.**

- **Wall**: elapsed time.
- **CPU**: user plus system time of all threads, from `wait4()` or the scheduler's per-thread statistics.
- **Peak memory**: maximum resident set.
- **Own memory**: private dirty pages (`smaps_rollup`). This is what a process costs beyond shared and file-backed pages, which
  matters for Pi-Bolt: its code and prebuilt heap are file-backed.

**The machine is shared.** It is a cloud VM that other heavy jobs also use. Interleaving keeps comparisons fair, but absolute
figures vary between sessions. Figures from sessions taken under heavy load were discarded and re-run.

## In a real terminal (tmux)

Pi in a 160×48 tmux pane ([`bench/tmux_check.py`](../bench/tmux_check.py)): keys sent with `send-keys`, the screen read back
with `capture-pane`, and the model streaming at human pace, one event every 10 ms.

| | Pi-Bolt 0.8.5 | Pi on Bun 1.4.2 | Pi on Node 24 |
|---|---:|---:|---:|
| Streaming a 20,000-character answer: CPU | **0.6 s** | 8.0 s | 6.3 s |
| Streaming a 60,000-character answer: CPU | **2.6 s** | 40.2 s | 38.7 s |
| Share of a core while it streams (60,000 characters) | **5%** | 80% | 77% |
| Writing a 200 KB file through a tool call (`pi -p`) | **0.6 s** | 24.0 s | 32.5 s |
| Writing a 200 KB file through a tool call: CPU | **0.2 s** | 32.5 s | 33.1 s |

On the Mac: streaming a 60,000-character answer took 6.5 s of CPU (Pi on Bun 37.9 s, on Node 37.6 s), and writing a 200 KB file
0.4 s (Bun 22.6 s, Node 28.1 s).

`bench/long_answer.py` streams Markdown answers (headings, lists, code blocks in several languages, tables) into the TUI at 1,200
characters a second, 24 at a time, and measures the CPU Pi uses until the answer has been drawn. `bench/large_write.py` has the
model write a file of TypeScript through the `write` tool, its arguments streaming 16 characters at a time (about one token),
and measures `pi -p` from start to exit. Means of two runs on Linux, pinned to 4 cores. Bun and Node run Pi 1.1.0 as released.

Both come from Pi's own code, not from the runtime. Pi draws a message again each time a few more words arrive, with a new
component that lexes the whole Markdown text, renders and wraps every block and highlights every code block, so the cost of each
redraw grows with the length of the answer. Pi-Bolt keeps what it lexed and rendered, and does again only the last two blocks
(where a block ends depends on the line after it); highlighted code is kept by language and text. What is drawn is the same, line
for line and color for color (`bench/e2e_screen.py`). Pi also parses all of a tool call's arguments each time a few more
characters arrive; Pi-Bolt parses them again only once they have grown by an eighth while they stream, and in full when the call
is complete. And Pi highlights every line of a file being written, and all of it again on every redraw once it is complete;
Pi-Bolt highlights the lines a collapsed call shows, and the rest when the call is expanded.

## Plugins

The example plugin ([`examples/plugins`](../examples/plugins)): a `/words` command that counts the words of a 16.8 MB file in a
character loop, timed inside Pi with `performance.now()`. See [PLUGINS.md](PLUGINS.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/bench-plugins-dark.svg">
  <img alt="Plugin hot loop and launch time: compiled in vs loaded at run time on Pi-Bolt, Pi-Bolt with JIT on, and Bun" src="images/bench-plugins-light.svg">
</picture>

| How the plugin runs | Launch to interactive | `/words` hot loop |
|---|---:|---:|
| **Compiled in**, Pi-Bolt (default, JIT off) | 52 ms | 55 ms |
| Compiled in, Pi-Bolt JIT on | **50 ms** | 68 ms |
| Loaded at run time, Pi-Bolt JIT off (interpreted) | 91 ms | 1,315 ms |
| Loaded at run time, Pi-Bolt JIT on | 83 ms | 48 ms |
| Loaded at run time, Bun 1.4.2 | 244 ms | **45 ms** |

Linux, medians of 5 sessions, each running `/words` 5 times, Pi-Bolt 0.7.3. The hot-loop figure is the median of runs 2–5.

## Questions

### Why is a run-time plugin's loop slow on the default build?

Because that plugin's code is not compiled at all on that build: it runs in JavaScriptCore's bytecode interpreter.

- The default Pi-Bolt executable runs with the **JIT off**. Pi's own code does not need a JIT: all of it was compiled to machine
  code when the executable was built.
- A plugin loaded at **run time** (from `~/.pi/agent/extensions`, a project's `.pi/extensions` or a Pi package) is not part of
  that build. `jiti` turns its TypeScript into JavaScript when Pi starts. With no JIT, JavaScriptCore can then only interpret
  it, and an interpreter runs a tight loop 20–30× slower than compiled code.
- Stock Bun's JIT compiles the loop after a few thousand iterations, which is how it gets to 45 ms.

This is not a regression. The figure is the same in every Pi-Bolt release: it is the cost of loading code at run time into a
runtime with no JIT. There are two ways around it:

| | Plugin hot loop |
|---|---:|
| Compile the plugin in: `scripts/build-pi.sh --plugins` ([PLUGINS.md](PLUGINS.md)) | 55 ms, and nothing measurable at launch instead of 39 ms |
| Use the JIT-on build (`pi-bolt-linux-x64-jit`) and keep loading it at run time | 48 ms after warm-up (Bun: 45 ms) |
| Load it at run time on the default (JIT-off) build | 1,315 ms |

## Reproduce

```bash
scripts/package-release.sh                      # out/pi-bolt, out/pi-bolt-baseline, out/pi-bolt-jit
scripts/build-pi.sh --plugins examples/plugins/plugins.ts --out out/pi-bolt-plugins
scripts/build-pi.sh --plugins examples/plugins/plugins.ts --jit on --out out/pi-bolt-plugins-jit
scripts/prepare-pi.sh --tag v1.1.0 --dir ../pi-1.1.0                              # Pi as released
scripts/build-pi.sh --stable --pi ../pi-1.1.0 --out out/pi-stable-upstream
PIBOLT_PI=../pi-1.1.0 PIBOLT_STABLE_PI=out/pi-stable-upstream/pi PIBOLT_COMPARE="pi-bolt-0.7.0=<0.7.0's pi>" \
	bench/run-suite.sh bench/results/my-run --cpus 8-15   # about an hour; then charts and tables from bench/report.py
B="--cpus 8-15 --build pi-bolt=out/pi-bolt/pi --build bun=out/pi-stable-upstream/pi"
python3 bench/long_answer.py $B --sizes 20000,60000
python3 bench/large_write.py $B --sizes 50,200
python3 bench/tmux_load.py $B --steps md:20000
```

Each tool also runs on its own, with any builds given as `--build name=command`. See [`bench/README.md`](../bench/README.md).

## Correctness

Speed is only measured on builds that pass the correctness checks:

- `bench/e2e_tools.py`: every Pi tool, with output and files byte-identical to stock Bun's.
- `bench/ui_check.py` and `bench/tmux_check.py`: the TUI.
- `tests/aot/run.sh`: engine tests, and `tests/aot/fuzz/run.sh`: random programs compiled ahead of time must print what they
  print as bytecode.
- JavaScriptCore's own stress tests, run with and without AOT compilation: 4,779 of the 4,786 that run behave the same. The 7
  that differ inspect JIT internals that do not exist without a JIT.

See [BUILDING.md](BUILDING.md#tests).
