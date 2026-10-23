# Third-party notices

Pi-Bolt's own files (scripts, benchmarks, tests, documentation, examples) are under the [MIT license](LICENSE). Pi-Bolt builds on,
patches and redistributes the following projects, each under its own license.

| Project | Used for | License |
|---|---|---|
| [Pi](https://github.com/earendil-works/pi) (coding agent), © Mario Zechner | The application compiled by Pi-Bolt; the release executables contain it; `bench/fixtures/` holds four of its source files as test input | MIT |
| [Bun](https://github.com/oven-sh/bun), © Oven | The runtime; `patches/bun.patch` modifies it | MIT (see Bun's `LICENSE.md` for the libraries it links) |
| [WebKit / JavaScriptCore](https://github.com/oven-sh/WebKit) | The JavaScript engine; `patches/webkit.patch` modifies it | LGPL-2.0 and BSD-2-Clause (per file) |
| [ICU](https://github.com/unicode-org/icu) | Unicode support, linked statically into the Linux release runtime (the macOS runtime uses the system's) | Unicode License v3 |
| [GNU C Library](https://www.gnu.org/software/libc/) / [GCC libstdc++](https://gcc.gnu.org/) (Ubuntu 20.04 sysroot) | Build-time sysroot, so that the executables run on glibc 2.17 and later | LGPL-2.1 / GPL-3.0 with the GCC Runtime Library Exception |

## JavaScriptCore and the LGPL

JavaScriptCore is licensed under the GNU Lesser General Public License (LGPL-2.0), and the release executables link a modified
copy of it. The complete corresponding source is:

- the upstream WebKit commit named in [`sources.json`](sources.json), plus
- the patch [`patches/webkit.patch`](patches/webkit.patch),

which [`scripts/fetch-sources.sh`](scripts/fetch-sources.sh) and [`scripts/build-runtime.sh`](scripts/build-runtime.sh) combine and
build exactly as the releases were built ([docs/BUILDING.md](docs/BUILDING.md)). The patches are distributed under the licenses of
the files they modify.

## Color palettes

The built-in themes other than `dark`, `light` and `system` (in
[`packages/coding-agent/src/modes/interactive/theme/`](packages/coding-agent/src/modes/interactive/theme/)) use the color values of
the palettes below. Only the colors are taken; each is assigned to Pi's theme tokens, and some are blended with the background or
nudged toward the text color for contrast, so the files are adaptations, not copies of the originals' themes.

| Palette (themes) | Source | Copyright | License |
|---|---|---|---|
| Catppuccin (`catppuccin-mocha`, `-macchiato`, `-frappe`, `-latte`) | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin) | © 2021 Catppuccin | MIT |
| Dracula (`dracula`) | [dracula/dracula-theme](https://github.com/dracula/dracula-theme) | © 2023 Dracula Theme | MIT |
| Nord (`nord`) | [nordtheme/nord](https://github.com/nordtheme/nord) | © 2016-present Sven Greb | MIT |
| Gruvbox (`gruvbox-dark`, `gruvbox-light`) | [morhetz/gruvbox](https://github.com/morhetz/gruvbox) | Pavel Pertsev (the repository has no license file; its README says MIT/X11 and its `package.json` says MIT) | MIT |
| Solarized (`solarized-dark`, `solarized-light`) | [altercation/solarized](https://github.com/altercation/solarized) | © 2011 Ethan Schoonover | MIT |
| Tokyo Night (`tokyo-night`, `tokyo-night-storm`) | [tokyo-night/tokyo-night-vscode-theme](https://github.com/tokyo-night/tokyo-night-vscode-theme) (Enkia) | © 2018-present Enkia | MIT |
| Tokyo Night Day (`tokyo-night-day`) | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim) | Folke Lemaitre (the license file carries no copyright line) | Apache-2.0 |
| One Dark (`one-dark`) | [atom/atom](https://github.com/atom/atom/tree/master/packages/one-dark-syntax), `one-dark-syntax` | © 2016 GitHub Inc. | MIT |
| Rosé Pine (`rose-pine`) | [rose-pine/rose-pine-theme](https://github.com/rose-pine/rose-pine-theme) | © 2023 Rosé Pine | MIT |
| Monokai (`monokai`) | [tinted-theming/schemes](https://github.com/tinted-theming/schemes), `base16/monokai.yaml` (palette by Wimer Hazenberg, [monokai.nl](https://monokai.nl)) | © 2022 Tinted Theming | MIT |

The MIT-licensed palettes are used under this permission, which applies to each copyright holder above:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
> (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included
> in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
> IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Tokyo Night Day's colors come from folke/tokyonight.nvim, which is under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).
