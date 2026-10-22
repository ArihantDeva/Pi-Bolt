<p align="center">
  <a href="https://github.com/opensec-git/Pi-Bolt">
    <img alt="Pi-Bolt logo" src="docs/images/logo.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://github.com/opensec-git/Pi-Bolt/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/opensec-git/Pi-Bolt/ci.yml?branch=pi-bolt&event=push&style=flat-square&label=ci" /></a>
  <a href="https://github.com/opensec-git/Pi-Bolt/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/opensec-git/Pi-Bolt?style=flat-square&color=2a78d6" /></a>
  <a href="https://www.npmjs.com/package/pi-bolt"><img alt="npm" src="https://img.shields.io/npm/v/pi-bolt?style=flat-square&logo=npm&logoColor=white&color=2a78d6" /></a>
  <a href="https://www.npmjs.com/package/pi-bolt"><img alt="npm downloads" src="https://img.shields.io/npm/dm/pi-bolt?style=flat-square&color=2a78d6" /></a>
  <a href="https://github.com/opensec-git/Pi-Bolt/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/opensec-git/Pi-Bolt?style=flat-square&color=f0b03a" /></a>
  <a href="sources.json"><img alt="The Pi release Pi-Bolt is built on" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fopensec-git%2FPi-Bolt%2Fpi-bolt%2Fsources.json&query=%24.pi.tag&label=pi&color=f0b03a&style=flat-square" /></a>
  <a href="#requirements"><img alt="Linux x86-64" src="https://img.shields.io/badge/linux-x86--64-444?style=flat-square&logo=linux&logoColor=white" /></a>
  <a href="#requirements"><img alt="macOS Apple silicon" src="https://img.shields.io/badge/macOS-Apple%20silicon-444?style=flat-square&logo=apple&logoColor=white" /></a>
  <a href="#requirements"><img alt="Windows x64" src="https://img.shields.io/badge/windows-x64-444?style=flat-square&logo=windows&logoColor=white" /></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-1baf7a?style=flat-square" /></a>
</p>

<h1 align="center">Pi-Bolt</h1>

<p align="center"><b>The <a href="https://github.com/earendil-works/pi">Pi</a> coding agent, compiled ahead of time to native code.</b><br>
One executable for Linux x86-64 and ARM64, macOS on Apple silicon and Windows x64. No JIT, no Node.js or Bun required.</p>

Pi-Bolt is the Pi you already use, with the same commands, sessions, settings, providers and extensions. Every function is
compiled to machine code when the executable is built, so nothing is parsed or JIT-compiled at launch. Against Pi as released on
Node 24, it writes a 400 KB file 112 times faster, uses 13 times less CPU while a long answer streams, 6 times less over a
session and a third of the memory; against Pi on stock Bun, much the same.

<img alt="Pi-Bolt 0.9.7 against Pi 1.3.0 as released, Linux x86-64: writing a 400 KB file 112 times faster than on Node 24 (140 times than on Bun), 13 times less CPU while a long answer streams, 6.2 times less CPU over an interactive session, 3.5 times less memory after 40 prompts" src="docs/images/pi-bolt-benchmarks.png" width="880">

<img alt="Pi-Bolt 0.9.7 against Pi 1.3.0 as released on Node 24 and on Bun, on Linux x86-64, Linux ARM64, macOS and Windows: 70 to 140 times faster writing a 400 KB file, 11 to 14 times less CPU streaming a long answer, 5 to 6 times less CPU per prompt and per session, 1.4 to 4.2 times less memory, 3 to 9 times sooner ready to type" src="docs/images/pi-bolt-every-platform.png" width="880">

<a href="https://pi-bolt.opensec.in/pi-bolt.mp4"><img alt="Video, 2:11: Pi-Bolt and Pi on Node 24 side by side with a real model: startup, a game built with todos and two subagents, a long answer streamed into tmux and cmux, and benchmarks on every platform" src="docs/images/video-poster.jpg" width="880"></a>

> [!NOTE]
> Pi-Bolt is an independent fork of [Pi](https://github.com/earendil-works/pi), not affiliated with Pi's authors or with Oven.

## Install

```bash
curl -fsSL https://pi-bolt.opensec.in/install.sh | sh
```

The same command installs Pi-Bolt on Linux x86-64 and ARM64, on macOS, and on Android in Termux. On Arch Linux there is also
a community package in the AUR, [`pi-bolt-avx2-bin-release-git`](https://aur.archlinux.org/packages/pi-bolt-avx2-bin-release-git)
(the x86-64 AVX2 build, signature checked): `paru -S pi-bolt-avx2-bin-release-git`.

On Windows, in PowerShell:

```powershell
irm https://pi-bolt.opensec.in/install.ps1 | iex
```

or in Command Prompt:

```bat
powershell -c "irm https://pi-bolt.opensec.in/install.ps1 | iex"
```

or `npm install -g --allow-scripts=pi-bolt pi-bolt`, or `bun add -g --trust pi-bolt`. Then run `pi-bolt` in your project. Your
Pi configuration in `~/.pi/agent` is used as is; new to Pi? Run `/login` to connect a provider. `pi-bolt update` installs the
latest release, `pi-bolt update --rollback` puts back the build it replaced, and `pi-bolt update --channel beta` takes
pre-releases too.

The installer verifies the release signature and offers three optional extensions by OpenSec:

| Extension | What it does |
|---|---|
| [`opensec-pi-subagents`](https://www.npmjs.com/package/opensec-pi-subagents) | Specialized agents in separate sessions, parallel workflows and scheduled jobs |
| [`opensec-pi-todo`](https://www.npmjs.com/package/opensec-pi-todo) | A todo list for the model, shown as a live panel above the editor |
| [`opensec-pi-fff`](https://www.npmjs.com/package/opensec-pi-fff) | pi-fff's fast fuzzy find, grep and `@`-mentions, at full speed on the default build |

### JIT build, for heavy plugins

The default build has no JIT: Pi's own code is compiled machine code, and an extension loaded at run time is interpreted. Light
extensions don't notice. For extensions that do heavy work (search, parsing) or use `bun:ffi`, install the JIT
build. Pi itself stays compiled, so it is within about 5% of the default.

```bash
curl -fsSL https://pi-bolt.opensec.in/install.sh | PIBOLT_VARIANT=arm64-jit sh   # macOS, Linux ARM64, Termux
curl -fsSL https://pi-bolt.opensec.in/install.sh | PIBOLT_VARIANT=x64-jit sh     # Linux x86-64
```

On Windows, run `$env:PIBOLT_VARIANT = "x64-jit"` before the PowerShell command. With npm, keep `PIBOLT_VARIANT` set in your
shell profile; it is read on every run. `pi-bolt --version` then ends in `JIT on`, and `pi-bolt update` keeps the build you chose.

On the default build, an extension that needs the JIT (it calls into a native library through `bun:ffi`) fails with a line that
names the extension and gives the command that switches to the JIT build.

<details>
<summary>Manual download</summary>

Download a build from the [latest release](https://github.com/opensec-git/Pi-Bolt/releases/latest), check it against
`SHA256SUMS`, unpack it and run `./pi` (on Windows, `pi-bolt.exe`).

| Download | For |
|---|---|
| `pi-bolt-linux-x64.tar.xz` | **Linux**, CPUs with AVX2 (Intel Haswell, AMD Zen and later) |
| `pi-bolt-linux-x64-baseline.tar.xz` | Linux, any x86-64 CPU |
| `pi-bolt-linux-arm64.tar.xz` | **Linux** ARM64, any 64-bit ARM CPU (Raspberry Pi 3 and later, AWS Graviton, Ampere) |
| `pi-bolt-darwin-arm64.tar.xz` | **macOS**, Apple silicon |
| `pi-bolt-win32-x64.zip` | **Windows** x64; compiled code on CPUs with AVX2, bytecode on others |

`-jit` builds are for heavy use of plugins loaded at run time; the runtime and kit archives are what `pi-bolt compile` builds
with ([compiling plugins in](docs/PLUGINS.md)).
In Termux, use the installer: it sets the executable's loader to Termux's glibc ([below](#android-termux)).

</details>

### Android (Termux)

In [Termux](https://termux.dev) from F-Droid or GitHub (the Google Play version has no glibc packages), run the same `curl ... | sh` command. Pi-Bolt is a glibc program and Android's libc is not
glibc, so the installer first installs Termux's glibc (`pkg install glibc-repo && pkg install glibc`, after asking), sets it as
the executable's loader, and links `pi-bolt` into `$PREFIX/bin`. `pi-bolt` is a small launcher that starts Pi-Bolt in Android's
time zone and without Termux's `LD_PRELOAD` (a library of Android's libc, which glibc cannot load); the programs Pi-Bolt starts
get it back. The installer copies Termux's `resolv.conf` and `hosts` to `$PREFIX/glibc/etc`, where Termux's glibc reads them.

### Requirements

- **Linux** x86-64 or ARM64 with glibc 2.17 or later (Ubuntu 20.04+, Debian 11+, RHEL/Rocky 8+, Amazon Linux 2, Raspberry Pi
  OS 64-bit). musl is not supported.
- **Android** 7 or later on 64-bit ARM, in Termux.
- **macOS** 13 or later on Apple silicon. Install with the installer or npm ([Troubleshooting](docs/TROUBLESHOOTING.md#macos)).
- **Windows** 10 (1809) or later, or Windows 11, on x64. Install with the installer or npm; for problems, see [Troubleshooting: Windows](docs/TROUBLESHOOTING.md#windows).
- Windows on ARM64 runs the x64 build, in Windows 11's x64 emulation.

Pi-Bolt installs next to Pi as `pi-bolt`, so both can stay installed. Running the installer again updates, reinstalls or
uninstalls it.

## Benchmarks

Pi-Bolt 0.9.7 against Pi 1.3.0 as released on npm, run by stock Bun 1.4.2 and by Node 24, doing the same work against the same
local model; lower is better. Pi-Bolt / Pi on Bun / Pi on Node 24:

| Benchmark | Linux x86-64 | Linux ARM64 | macOS | Windows x64 |
|---|---:|---:|---:|---:|
| Writing a 400 KB file through a tool call, s | **1.3** / 182.2 / 145.8 | **1.3** / 157.3 / 131.8 | **1.7** / 129.7 / 129.2 | **1.6** / 139.4 / 112.1 |
| CPU, streaming a 60,000-character answer, s | **2.94** / 41.14 / 37.87 | **3.01** / 40.45 / 37.55 | **5.40** / 66.68 / 63.16 | **3.39** / 44.58 / 38.20 |
| CPU per prompt, prompts 21 to 40 of a session, ms | **65** / 350 / 362 | **58** / 308 / 301 | **47** / 272 / 291 | **59** / 303 / 361 |
| CPU, interactive session, ms | **190** / 1,189 / 1,179 | **196** / 1,187 / 1,183 | **199** / 1,133 / 1,287 | **243** / 1,407 / 1,280 |
| Memory after 40 prompts, MB | **166** / 289 / 578 | **197** / 267 / 612 | **182** / 423 / 762 | **141** / 262 / 325 |
| Ready to type, ms | **45** / 382 / 411 | **44** / 353 / 410 | **85** / 253 / 383 | **93** / 315 / 363 |

GitHub's runners: Linux pinned to one CPU, macOS on Apple M1 (3 CPUs), Windows on 2 cores; memory on Windows is the working
set. Node 22, the method and the raw data: [`bench/results/2026-10-21-stock-bun-0.9.7`](bench/results/2026-10-21-stock-bun-0.9.7)
and [docs/BENCHMARKS.md](docs/BENCHMARKS.md#097-against-pi-as-released).

### Against PiG

Pi-Bolt 0.9.6 against [PiG](https://github.com/MichaelKinsy/PiG) 0.5.1 (Pi ported to Go) and Pi 1.3.0 on Node 24, doing the
same work against the same local model; lower is better.

On GitHub's Linux x86-64 runner, one CPU each:

| Benchmark | Pi-Bolt 0.9.6 | PiG 0.5.1 | Pi on Node 24 |
|---|---:|---:|---:|
| Ready to type | 42 ms | **15 ms** | 362 ms |
| CPU, one prompt (`pi -p`) | 56 ms | **25 ms** | 506 ms |
| CPU, interactive session | 164 ms | **141 ms** | 1,026 ms |
| CPU, streaming a 60,000-character answer | 2.6 s | **1.5 s** | 34.7 s |
| CPU, writing files in a terminal (tmux) | **1.1 s** | 2.7 s | 13.5 s |
| Bytes sent to the terminal for a 20,000-character answer | **528 KB** | 3,573 KB | 3,562 KB |
| Peak memory, one prompt | 133 MB | **55 MB** | 148 MB |
| Memory after 40 prompts | 173 MB | **87 MB** | 574 MB |

On an Apple M5 Mac:

| Benchmark | Pi-Bolt 0.9.6 | PiG 0.5.1 |
|---|---:|---:|
| Ready to type | 31 ms | **22 ms** |
| CPU, one prompt (`pi -p`) | 27 ms | **18 ms** |
| CPU, interactive session | **91 ms** | 125 ms |
| CPU per prompt, 40 prompts into a session | **19 ms** | 27 ms |
| CPU, streaming a 60,000-character answer | 3.4 s | **2.3 s** |
| CPU, writing files in a terminal (tmux) | **1.9 s** | 4.4 s |
| Peak memory, interactive session | 41 MB | **26 MB** |

PiG starts sooner and uses less memory; Pi-Bolt runs Pi's own code, so every Pi extension works unchanged. Linux ARM64,
Windows, the raw data and the method: [docs/BENCHMARKS.md](docs/BENCHMARKS.md#096-against-pig-051).

## Plugins

Pi extensions work unchanged. The default build has no JIT, so an extension loaded at run time is interpreted; compile the ones
you use every day into Pi-Bolt, where they run as machine code:

```bash
pi-bolt compile
```

It compiles the extensions installed on this machine into your Pi-Bolt (Linux and macOS) with the release's own compiler, and
`pi-bolt update` compiles them into each new release. See [docs/PLUGINS.md](docs/PLUGINS.md).

Pi-Bolt's `grep` and `find` tools are on by default and search in-process, following `.gitignore`, with nothing to install.
With [`opensec-pi-fff`](https://www.npmjs.com/package/opensec-pi-fff) or `@ff-labs/pi-fff` loaded, FFF's search tools are used
instead.

### Pi and Pi-Bolt side by side

Pi-Bolt uses Pi's agent directory (`~/.pi/agent`) and shared `packages` list. Ordinary `pi-bolt install` and `pi-bolt remove`
update that shared list, just as Pi does, and drop Pi-Bolt's own entry for that package, so both load what the shared list
declares. Add `--pi-bolt` to change only Pi-Bolt's overrides. Using fictional package names:

```bash
pi-bolt install --pi-bolt npm:@example/bolt-tools
pi-bolt remove --pi-bolt npm:@example/shared-tools
```

`piBolt.packages` extends the shared list. A `-source` entry excludes an inherited package from Pi-Bolt without changing Pi:

```json
{
  "packages": ["npm:@juicesharp/rpiv-todo"],
  "piBolt": { "packages": ["-npm:@juicesharp/rpiv-todo", "npm:opensec-pi-todo"] }
}
```

Other shared packages remain inherited. A `piBolt.packages` list copied from `packages` by Pi-Bolt before 0.9.1 is converted
once into exclusions and differing entries, so Pi-Bolt keeps loading what it did. See
[Configuration](https://pi-bolt.opensec.in/docs/configuration.html).

## Herdr

In a [Herdr](https://herdr.dev) pane, Pi-Bolt shows up as `pi-bolt` (idle, working or blocked), and a Herdr restart reopens
the same conversation in the same pane. There is nothing to install; `"-builtin:herdr"` in the `extensions` setting turns it
off. Restoring a session needs Herdr 0.9.2 or later.

To start other agents in Herdr panes from Pi-Bolt, install [pi-herdr](https://www.npmjs.com/package/@andrewjacop/pi-herdr):
`pi-bolt install npm:@andrewjacop/pi-herdr`.

## Editors

`pi-bolt --acp` speaks the [Agent Client Protocol](https://agentclientprotocol.com), so Pi-Bolt runs in the agent panel of Zed,
JetBrains IDEs, VS Code (through an ACP extension), Neovim and other ACP editors, with your Pi settings, extensions, skills and
sessions. In Zed's `settings.json`:

```json
"agent_servers": {
  "Pi-Bolt": { "type": "custom", "command": "/full/path/to/pi-bolt", "args": ["--acp"], "env": {} }
}
```

Other editors, and what the editor gets: [docs/ACP.md](docs/ACP.md).

`pi-bolt --mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server, so other agents give Pi-Bolt a task with
its `prompt` tool and continue the session in later calls. In Claude Code:

```bash
claude mcp add pi-bolt -- /full/path/to/pi-bolt --mcp
```

Other clients, and what the tools do: [docs/MCP.md](docs/MCP.md).

## Doctor

`pi-bolt doctor` prints a report of your installation, in plain text to paste into an issue: the build and how it was installed,
whether the release's signature verifies, which extensions are compiled in, run at run time or fail to load, how Pi's `packages`
and `piBolt.packages` differ, the Herdr and editor setup, and the problems it finds, such as another `pi-bolt` earlier on your
`PATH`. It prints no keys or tokens, and shows your home folder as `~`. `pi-bolt doctor --offline` leaves out the release
signature and the check for a newer version.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/how-it-works-dark.svg">
  <img alt="Build time: Pi is bundled and compiled to bytecode by bun build, then every function is compiled to machine code by the AOT compiler, guided by a training profile. The result is one executable holding the Bun runtime, a prebuilt heap and the machine code. At launch, pi maps the code and heap from the file and runs main()." src="docs/images/how-it-works-light.svg">
</picture>

1. **Bun bundles Pi** and compiles it to JavaScriptCore bytecode.
2. **An ahead-of-time compiler** turns every function into optimized x86-64 or ARM64 machine code, through B3, the back end of
   JavaScriptCore's top-tier JIT.
3. **A prebuilt heap** holds Pi's modules already loaded, and is mapped from the executable at launch.
4. **A training profile** orders the code so that startup touches as few pages as possible.

The compiler builds on [oven-sh/WebKit#743](https://github.com/oven-sh/WebKit/pull/743). Pi-Bolt ports it to x86-64 and macOS
and adds its own code generation and runtime work ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)). `packages/` is the Pi release named
in [`sources.json`](sources.json) with Pi-Bolt's changes on top; the engine changes are in
`patches/`.

## Documentation

| | |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | What the executable contains, how it is built, what happens at launch |
| [Building](docs/BUILDING.md) | Building the runtime and Pi from source, training profiles, tests |
| [Benchmarks](docs/BENCHMARKS.md) | Method, results and raw data |
| [Plugins](docs/PLUGINS.md) | Porting Pi extensions and writing them for AOT |
| [Editors](docs/ACP.md) | Pi-Bolt in Zed, JetBrains IDEs, VS Code and other ACP editors |
| [Other agents](docs/MCP.md) | Pi-Bolt as a tool of other agents and MCP clients |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Diagnostics, environment variables, known limitations |
| [Releasing](docs/RELEASING.md) | CI, releases, signing |

## Development

```bash
git clone https://github.com/opensec-git/Pi-Bolt.git && cd Pi-Bolt
scripts/fetch-runtime.sh            # the released Pi-Bolt runtime (or build it: docs/BUILDING.md)
scripts/prepare-pi.sh               # builds the Pi in this repository
scripts/build-pi.sh                 # out/pi-bolt/pi
tests/aot/run.sh                    # engine tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately, as described in [SECURITY.md](SECURITY.md).

## Star history

<a href="https://www.star-history.com/#opensec-git/pi-bolt&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=opensec-git/pi-bolt&type=Date&theme=dark">
    <img alt="Star history of Pi-Bolt" src="https://api.star-history.com/svg?repos=opensec-git/pi-bolt&type=Date" width="600">
  </picture>
</a>

## License

MIT. Release executables include Bun (MIT), JavaScriptCore (LGPL-2.0 and BSD), ICU (Unicode License) and Pi (MIT); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<p align="center">
  Built on <a href="https://github.com/earendil-works/pi">Pi</a> by Mario Zechner and contributors,
  and <a href="https://github.com/oven-sh/bun">Bun</a> by Oven.
</p>
