#!/usr/bin/env python3
"""check-darwin-imports.py RUNTIME [SDK]

The macOS runtime links six of libSystem's libraries by name (Bun patch: "macOS: import libSystem's functions from the
libraries that export them"), so that its imports name the library that exports them: one lookup each at launch instead of
a search through libSystem's re-exported libraries. That must not change what an import binds to. Through libSystem, dyld
takes the first of its re-exported libraries, in their order, that exports the name; the linker takes the first library on
its command line. Where two of them export the same name, those can differ. This checks, against the SDK's stubs (.tbd),
that every import from a libsystem_* library is the one that libSystem would have given, and exits 1 if one is not.
"""
import os
import re
import shutil
import subprocess
import sys


def exported_names(tbd: str) -> set[str]:
    names: set[str] = set()
    for match in re.finditer(r"(?:symbols|weak-symbols|thread-local-symbols):\s*\[([^\]]*)\]", open(tbd).read()):
        names.update(name.strip().strip("'\"") for name in match.group(1).split(","))
    names.discard("")
    return names


def main() -> int:
    runtime = sys.argv[1]
    sdk = sys.argv[2] if len(sys.argv) > 2 else subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    if not shutil.which("dyld_info"):
        print("check-darwin-imports: no dyld_info on this machine: not checked", file=sys.stderr)
        return 0
    umbrella = open(os.path.join(sdk, "usr/lib/libSystem.B.tbd")).read().split("exports:")[0]
    order = re.findall(r"'/usr/lib/system/([^']+)\.dylib'", umbrella)
    exports = {}
    for library in order:
        path = os.path.join(sdk, "usr/lib/system", f"{library}.tbd")
        if os.path.exists(path):
            exports[library] = exported_names(path)
    checked = 0
    wrong = []
    for line in subprocess.check_output(["dyld_info", "-imports", runtime], text=True).splitlines():
        match = re.match(r"\s*0x[0-9A-Fa-f]+\s+(\S+)\s+\(from (libsystem_\S+)\)", line)
        if not match:
            continue
        name, library = match.groups()
        checked += 1
        through_libsystem = next((lib for lib in order if name in exports.get(lib, ())), None)
        if through_libsystem != library:
            wrong.append(f"{name}: from {library}, through libSystem from {through_libsystem}")
    for line in wrong:
        print(f"check-darwin-imports: {line}", file=sys.stderr)
    print(f"check-darwin-imports: {checked} imports from libSystem's libraries, {len(wrong)} not as libSystem would bind them")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
