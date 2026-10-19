#!/usr/bin/env python3
"""What of a Pi-Bolt build runs outside its compiled code: per scenario, the functions that ran without code in the image (in the
interpreter, with the JIT off), the regular expressions compiled at run time because the image has none for them, and how many
inline cache slots were filled (each fill is a call into the runtime, ~700 instructions on Apple M-series).

The build runs with BUN_JSC_verboseAOTCompilation=1 (the runtime logs each function it finds no code for, each regular expression
not in the image and each slot it fills) and BUN_JSC_aotRecordRegExpsPath. Scenarios: headless (`pi -p`, 4 reads), interactive (5
prompts), a 20,000-character Markdown answer, tool calls whose results the TUI renders (`train`), the Anthropic and OpenAI
Responses APIs, and a session of 20 prompts.

A regular expression that the profile lists but the image still lacks is a plain string (an "atom": /bull/g): it is matched as a
string search and needs no code, so it is listed apart. Any other one missing is worth adding to the training (scripts/lib/
train_session.py, then scripts/train-profile.sh).

Example: bench/aot_coverage.py --build pi-bolt=./out/pi-bolt/pi [--profile profiles/pi-1.3.0] [--out DIR] [--only headless,...]
"""

import argparse
import collections
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402
from harness import DONE, PROMPT, Tty, done, fake_model, parse_builds, pi_env, pi_home, workdir  # noqa: E402

NO_CODE = re.compile(r"^AOT: (?:no key for|not in the image:) (.*?) of (.*?)(?: \(module .*)?$")
REGEXP = re.compile(r"^AOT: regexp not in the image: (.*)$")
SLOT = re.compile(r"^AOT: slot (0x[0-9a-f]+) filled")


def headless(build, extra, err):
    with fake_model() as port, pi_home(port) as home, workdir() as cwd, open(err, "wb") as stderr:
        p = subprocess.Popen([*build.argv, "-p", "--no-session", "--model", "fake/fake-model", PROMPT], env=pi_env(home, extra),
                             cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=stderr)
        out = p.stdout.read()
        p.wait()
        return DONE.encode() in out


def tui(build, extra, err, steps, script="fake_model.py", pace=0, model="fake/fake-model"):
    with fake_model(pace_ms=pace, script=script) as port, pi_home(port) as home, workdir() as cwd:
        tty = Tty([*build.argv, "--no-session", "--model", model], pi_env(home, extra), cwd, cols=160, rows=48, stderr=str(err))
        deadline = time.perf_counter() + 600
        if not tty.wait_for("fake-model", 0, deadline):
            tty.quit(1)
            return False
        tty.settle(0.2, deadline)
        for send, wait in steps(cwd):
            start = len(tty.buf)
            tty.send(send.encode() + b"\r")
            if not tty.wait_for(wait, start, deadline):
                tty.quit(1)
                return False
            tty.settle(0.05, deadline)
        status, _ = tty.quit()
        return status == 0


def md(size):
    return lambda cwd: [(f"SCENARIO md:{size} CWD {cwd}", "Done: md, answer 1.")]


def apis(cwd):
    return [(f"SCENARIO md:5000 CWD {cwd}", "Done: md, answer 1."), (f"SCENARIO train CWD {cwd}", "Done: train.")]


SCENARIOS = {
    "headless": lambda b, e, f: headless(b, e, f),
    "interactive": lambda b, e, f: tui(b, e, f, lambda cwd: [(PROMPT, done(n)) for n in range(1, 6)]),
    "long-answer": lambda b, e, f: tui(b, e, f, md(20000), script="fake_model_stress.py", pace=1),
    "tools": lambda b, e, f: tui(b, e, f, lambda cwd: [(f"SCENARIO train CWD {cwd}", "Done: train.")], script="fake_model_stress.py", pace=1),
    "anthropic": lambda b, e, f: tui(b, e, f, apis, script="fake_model_stress.py", pace=1, model="fake-anthropic/fake-model"),
    "responses": lambda b, e, f: tui(b, e, f, apis, script="fake_model_stress.py", pace=1, model="fake-responses/fake-model"),
    "long-session": lambda b, e, f: tui(b, e, f, lambda cwd: [(PROMPT, done(n)) for n in range(1, 21)]),
}


def read_log(path):
    functions, regexps, slots = collections.Counter(), set(), collections.Counter()
    with open(path, "rb") as f:
        for raw in f:
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if m := SLOT.match(line):
                slots[m.group(1)] += 1
            elif m := NO_CODE.match(line):
                functions[f"{m.group(1) or '(anonymous)'} [{m.group(2) or 'no URL: a Bun builtin, or eval or new Function'}]"] += 1
            elif m := REGEXP.match(line):
                regexps.add(m.group(1))
    return functions, regexps, slots


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build", required=True, help="name=command: a Pi-Bolt build")
    ap.add_argument("--profile", help="the training profile the build was made with (its regexps.txt tells atoms apart)")
    ap.add_argument("--only", help="scenarios, separated by commas: " + ",".join(SCENARIOS))
    ap.add_argument("--out", help="keep each scenario's log here (default: a temporary folder)")
    a = ap.parse_args()
    build = parse_builds([a.build])[0]
    # (Absolute: Pi runs in a scratch folder of its own, and the log and the regexps are written from there.)
    out = Path(a.out or tempfile.mkdtemp(prefix="pibolt-aot-coverage-")).resolve()
    out.mkdir(parents=True, exist_ok=True)
    profiled = set()
    if a.profile and (Path(a.profile) / "regexps.txt").exists():
        profiled = set((Path(a.profile) / "regexps.txt").read_text().splitlines())
    names = a.only.split(",") if a.only else list(SCENARIOS)
    all_functions, all_recorded = collections.Counter(), set()
    # (No time or instruction counts: the log the runtime writes for this costs more than Pi does.)
    print(f"{'scenario':14} {'ok':>3} {'no code':>8} {'regexps':>8} {'slots':>7} {'fills':>7} {'refills':>8}")
    for name in names:
        err, recorded = out / f"{name}.log", out / f"{name}.regexps"
        # (Both are appended to: a run into a folder used before starts from nothing.)
        err.unlink(missing_ok=True)
        recorded.unlink(missing_ok=True)
        extra = {"BUN_JSC_verboseAOTCompilation": "1", "BUN_JSC_aotRecordRegExpsPath": str(recorded)}
        ok = SCENARIOS[name](build, extra, err)
        functions, _, slots = read_log(err)
        lines = set(recorded.read_text().splitlines()) if recorded.exists() else set()
        all_functions.update(functions)
        all_recorded |= lines
        fills = sum(slots.values())
        print(f"{name:14} {'yes' if ok else 'NO':>3} {sum(functions.values()):>8} "
              f"{len(lines):>8} {len(slots):>7} {fills:>7} {fills - len(slots):>8}")
    print("\nfunctions without compiled code (times their code was looked for, all scenarios):")
    for function, n in all_functions.most_common():
        print(f"  {n:5}  {function}")
    print("\nregular expressions compiled at run time (flags/pattern, as regexps.txt has them):")
    for line in sorted(all_recorded):
        print(f"  {'in the profile (an atom, needs no code)' if line in profiled else 'not in the profile'}  {line}")
    print(f"\nlogs: {out}")


if __name__ == "__main__":
    main()
