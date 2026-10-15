"""`pi-bolt compile` with a release's compile kit and runtime, into an installation made from the build under test:
the extensions installed here are compiled in and used in place of their files; one changed since is loaded from its files
with a warning; one removed since is not loaded; the build it replaced is kept, and `pi-bolt update --rollback` swaps the two
(and back); `pi-bolt update --channel beta` is kept for the installation; and `--out` builds without installing. Uses the bench
fake model.
  python3 tests/pi/compile.py PI KIT RUNTIME     (KIT: pi-bolt-kit-<platform>.tar.gz or its folder; RUNTIME: the runtime's bun)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "bench"))
import harness  # noqa: E402

pi, kit, runtime = (str(Path(arg).resolve()) for arg in sys.argv[1:4])
failures = 0


def check(name, ok, detail=""):
    global failures
    print(f"{'PASS' if ok else 'FAIL'} {name}{'' if ok else f': {detail}'}")
    failures += 0 if ok else 1


# An extension that says how it was loaded: compiled in, its module is in the executable's own file system ($bunfs).
PROBE = """import { writeFileSync } from "node:fs";
export default function () {
	writeFileSync(`${process.env.PIBOLT_PROBE}/NAME`, import.meta.url);
}
"""

version = subprocess.run([pi, "--version"], capture_output=True, text=True, check=True).stdout
platform, variant = re.search(r"Pi-Bolt [^,]+, (\w+)-(\S+), JIT", version).groups()
with tempfile.TemporaryDirectory(prefix="pibolt-compile-") as tmp:
    tmp = Path(tmp)
    install = tmp / "install"
    build = install / f"pi-bolt-{platform}-{variant}"
    shutil.copytree(Path(pi).parent, build, symlinks=True)
    agent, probe = tmp / "agent", tmp / "probe"
    (agent / "extensions" / "folder-ext").mkdir(parents=True)
    probe.mkdir()
    (agent / "extensions" / "file-ext.ts").write_text(PROBE.replace("NAME", "file-ext"))
    (agent / "extensions" / "folder-ext" / "index.ts").write_text(
        'import "./helper.ts";\n' + PROBE.replace("NAME", "folder-ext"))
    (agent / "extensions" / "folder-ext" / "helper.ts").write_text("export const one = 1;\n")

    with harness.fake_model() as port, harness.pi_home(port) as home:
        for name in ("models.json", "auth.json", "settings.json"):
            shutil.copy(home / name, agent / name)
        env = harness.pi_env(agent, {"PIBOLT_PROBE": str(probe)})

        def compile_(*args):
            return subprocess.run([str(build / "pi"), "compile", "--kit", kit, "--runtime", runtime, *args], env=env,
                                  capture_output=True, text=True, stdin=subprocess.DEVNULL, cwd=tmp)

        def session():
            """`pi -p`: how each extension was loaded (its module's URL, or None), and what Pi printed."""
            for file in probe.iterdir():
                file.unlink()
            r = subprocess.run([str(build / "pi"), "-p", "--model", "fake/fake-model", "hello"], env=env,
                               capture_output=True, text=True, stdin=subprocess.DEVNULL, cwd=tmp)
            loaded = {name: (probe / name).read_text() if (probe / name).exists() else None
                      for name in ("file-ext", "folder-ext")}
            return r, loaded

        r, loaded = session()
        check("before: both extensions load from their files",
              r.returncode == 0 and all(url and url.startswith("file:") for url in loaded.values()), f"{loaded} {r.stderr[-300:]}")

        started = time.time()
        r = compile_()
        took = time.time() - started
        check("pi-bolt compile succeeds", r.returncode == 0, r.stdout[-500:] + r.stderr[-1500:])
        check("it names what it compiled in", "file-ext" in r.stderr and "folder-ext" in r.stderr, r.stderr[-500:])
        print(f"     (compile took {took:.1f} s)")
        record = json.loads((install / "compile.json").read_text()) if (install / "compile.json").exists() else {}
        check("compile.json keeps the extensions for the next update",
              sorted(record.get("extensions", [])) == ["file-ext", "folder-ext"], str(record))
        check("the build it replaced is kept as .previous", (install / f"{build.name}.previous" / "pi").exists())
        about = (build / "pi-bolt.txt").read_text()
        check("pi-bolt.txt says what is compiled in", "Extensions compiled in" in about and "file-ext" in about, about)
        out = subprocess.run([str(build / "pi"), "--version"], capture_output=True, text=True).stdout
        check("--version is the same version", out == version, f"{out!r} vs {version!r}")

        r, loaded = session()
        check("both compiled-in extensions run from the executable",
              r.returncode == 0 and all(url and "$bunfs" in url for url in loaded.values()), f"{loaded} {r.stderr[-300:]}")
        check("no warning while they are unchanged", "changed since" not in r.stderr, r.stderr[-300:])

        helper = agent / "extensions" / "folder-ext" / "helper.ts"
        helper.write_text("export const one = 2;\n")
        later = time.time() + 5
        os.utime(helper, (later, later))
        r, loaded = session()
        check("a changed extension is loaded from its files, the other stays compiled in",
              (loaded["folder-ext"] or "").startswith("file:") and "$bunfs" in (loaded["file-ext"] or ""), str(loaded))
        check("with a warning to compile it in again", "changed since it was compiled in" in r.stderr + r.stdout,
              r.stderr[-400:])

        (agent / "extensions" / "file-ext.ts").unlink()
        r, loaded = session()
        check("a removed extension is not loaded at all", loaded["file-ext"] is None, str(loaded))

        status = subprocess.run([str(build / "pi"), "compile", "--status"], env=env, capture_output=True, text=True)
        check("--status says what is compiled in", "file-ext" in status.stdout, status.stdout + status.stderr)

        def pi_bolt(*args):
            return subprocess.run([str(build / "pi"), *args], env=env, capture_output=True, text=True,
                                  stdin=subprocess.DEVNULL, cwd=tmp)

        r = pi_bolt("update", "--rollback")
        check("update --rollback puts back the build compile replaced",
              r.returncode == 0 and "Extensions compiled in" not in (build / "pi-bolt.txt").read_text()
              and "Extensions compiled in" in (install / f"{build.name}.previous" / "pi-bolt.txt").read_text(),
              r.stdout + r.stderr)
        r, loaded = session()
        check("after the rollback the extensions load from their files again",
              (loaded["folder-ext"] or "").startswith("file:"), str(loaded))
        r = pi_bolt("update", "--rollback")
        check("update --rollback again goes forward again",
              r.returncode == 0 and "Extensions compiled in" in (build / "pi-bolt.txt").read_text(), r.stdout + r.stderr)
        r = pi_bolt("update", "--channel", "beta")
        check("update --channel beta is kept for the installation",
              (install / "channel").exists() and (install / "channel").read_text().strip() == "beta", r.stdout + r.stderr)
        pi_bolt("update", "--channel", "stable")
        check("update --channel stable takes it away", not (install / "channel").exists())

        r = compile_("--out", str(tmp / "elsewhere"))
        check("--out builds without installing",
              r.returncode == 0 and (tmp / "elsewhere" / "pi").exists() and not (install / ".compile").exists(),
              r.stderr[-800:])
        leftovers = [p.name for p in install.iterdir() if p.name.startswith(".compile-")]
        check("nothing is left of the work folder", not leftovers, str(leftovers))

print("compile:", "all passed" if failures == 0 else f"{failures} failed")
sys.exit(1 if failures else 0)
