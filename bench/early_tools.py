#!/usr/bin/env python3
"""Tool calls followed by more text, streamed at a model's pace: how long Pi takes from the end of a message to the request
with the tool results, and the whole prompt.

The model (in this process, OpenAI chat completions or Anthropic messages) answers each of TURNS tool turns with some text, four
read-only tool calls (read, grep, find, ls) on a copy of this repository's packages/, and more text after them (--words-after),
one token-sized chunk every --pace-ms; then a final answer. It records when each message ended (its last byte sent) and when the next request
arrived: the gap between the two is the time Pi took to run the tools and send their results. A tool that starts while the
message is still streaming shortens it.

Reported per build (medians over interleaved runs of `pi -p`): gap_ms (the mean gap of a run's tool turns), wall_ms, cpu_ms,
and on macOS instr_m (instructions retired, millions).

Example: bench/early_tools.py --build base=out/base/pi --build cand=out/cand/pi --runs 15 [--api anthropic] [--pace-ms 15]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness
from harness import maxrss_mb, parse_builds, peak_footprint_mb, pi_env, pi_home, pinned

REPO = Path(__file__).resolve().parent.parent
TURNS = [
    [("read", {"path": "packages/coding-agent/src/core/agent-session.ts"}),
     ("grep", {"pattern": "async function \\w+", "path": "packages"}),
     ("find", {"pattern": "**/*.test.ts", "path": "packages"}),
     ("ls", {"path": "packages/coding-agent/src/core"})],
    [("read", {"path": "packages/ai/src/api/openai-completions.ts"}),
     ("grep", {"pattern": "export (type|interface) \\w+Options", "path": "packages"}),
     ("find", {"pattern": "**/*.md", "path": "packages"}),
     ("ls", {"path": "packages/agent/src"})],
    [("read", {"path": "packages/tui/src/tui.ts"}),
     ("grep", {"pattern": "AbortSignal", "path": "packages", "limit": 200}),
     ("find", {"pattern": "**/index.ts", "path": "packages"}),
     ("ls", {"path": "packages"})],
]
WORDS = ("Let me look at how the session wires its tools into the agent loop and where the results go before the next "
         "request is built ").split()
DONE = "Done: looked at the tools."


class Model:
    """The scripted model: what each request gets, and when messages ended and requests arrived."""

    def __init__(self, api: str, pace: float, words_after: int):
        self.api = api
        self.pace = pace
        self.words_after = words_after
        self.lock = threading.Lock()
        self.log: list[tuple[str, float]] = []

    def record(self, what: str) -> None:
        with self.lock:
            self.log.append((what, time.perf_counter()))

    def take_log(self) -> list[tuple[str, float]]:
        with self.lock:
            log, self.log = self.log, []
        return log


def text_chunks(words: int, offset: int = 0) -> list[str]:
    return [WORDS[(offset + i) % len(WORDS)] + " " for i in range(words)]


def arg_chunks(args: dict) -> list[str]:
    text = json.dumps(args)
    return [text[i:i + 4] for i in range(0, len(text), 4)]


def openai_events(turn: int, words_after: int) -> list[bytes]:
    def chunk(delta=None, finish=None):
        body = {"id": "chatcmpl-early", "object": "chat.completion.chunk", "created": 0, "model": "fake-model",
                "choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish}]}
        return f"data: {json.dumps(body)}\n\n".encode()

    out = [chunk({"role": "assistant", "content": ""})]
    if turn >= len(TURNS):
        out += [chunk({"content": word}) for word in text_chunks(20)]
        out += [chunk({"content": DONE}), chunk(finish="stop")]
    else:
        out += [chunk({"content": word}) for word in text_chunks(30)]
        for index, (name, args) in enumerate(TURNS[turn]):
            out.append(chunk({"tool_calls": [{"index": index, "id": f"call_{turn}_{index}", "type": "function",
                                              "function": {"name": name, "arguments": ""}}]}))
            out += [chunk({"tool_calls": [{"index": index, "function": {"arguments": piece}}]}) for piece in arg_chunks(args)]
        out += [chunk({"content": word}) for word in text_chunks(words_after, 7)]
        out.append(chunk(finish="tool_calls"))
    out.append(b"data: [DONE]\n\n")
    return out


def anthropic_events(turn: int, words_after: int) -> list[bytes]:
    def event(kind: str, body: dict) -> bytes:
        return f"event: {kind}\ndata: {json.dumps({'type': kind, **body})}\n\n".encode()

    usage = {"input_tokens": 1000, "output_tokens": 1}
    out = [event("message_start", {"message": {"id": "msg_early", "type": "message", "role": "assistant", "model": "fake-model",
                                               "content": [], "stop_reason": None, "usage": usage}})]
    index = 0

    def text(words: list[str]) -> None:
        nonlocal index
        out.append(event("content_block_start", {"index": index, "content_block": {"type": "text", "text": ""}}))
        out.extend(event("content_block_delta", {"index": index, "delta": {"type": "text_delta", "text": w}}) for w in words)
        out.append(event("content_block_stop", {"index": index}))
        index += 1

    if turn >= len(TURNS):
        text(text_chunks(20) + [DONE])
        stop = "end_turn"
    else:
        text(text_chunks(30))
        for n, (name, args) in enumerate(TURNS[turn]):
            out.append(event("content_block_start", {"index": index, "content_block": {
                "type": "tool_use", "id": f"toolu_{turn}_{n}", "name": name, "input": {}}}))
            out.extend(event("content_block_delta", {"index": index, "delta": {"type": "input_json_delta", "partial_json": p}})
                       for p in arg_chunks(args))
            out.append(event("content_block_stop", {"index": index}))
            index += 1
        if words_after:
            text(text_chunks(words_after, 7))
        stop = "tool_use"
    out.append(event("message_delta", {"delta": {"stop_reason": stop, "stop_sequence": None},
                                       "usage": {"output_tokens": 150}}))
    out.append(event("message_stop", {}))
    return out


def make_handler(model: Model):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self):
            super().setup()
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

        def log_message(self, *args):
            pass

        def do_GET(self):
            body = json.dumps({"object": "list", "data": [{"id": "fake-model", "object": "model"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            model.record("request")
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            turn = sum(1 for m in req.get("messages", []) if m.get("role") == "assistant")
            events = anthropic_events if model.api == "anthropic" else openai_events
            out = events(turn, model.words_after)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for n, piece in enumerate(out):
                if n and model.pace:
                    time.sleep(model.pace)
                self.wfile.write(f"{len(piece):x}\r\n".encode() + piece + b"\r\n")
                self.wfile.flush()
            # The message has ended with its last event (an OpenAI client closes the connection once it has [DONE]).
            model.record("end")
            try:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except OSError:
                pass

    return Handler


def project_copy() -> Path:
    """The tracked files of this repository's packages/, the project the tools look at."""
    d = Path(tempfile.mkdtemp(prefix="pibolt-early-"))
    archive = subprocess.run(["git", "-C", str(REPO), "archive", "HEAD", "packages"], check=True, capture_output=True).stdout
    subprocess.run(["tar", "-x", "-C", str(d)], input=archive, check=True)
    # (A git repository, as a project is: the search tools then follow its .gitignore.)
    subprocess.run(["git", "init", "-q", str(d)], check=True)
    return d


def run_once(build, model: Model, env: dict, cwd: Path, provider: str, cpus: str | None) -> dict:
    model.take_log()
    args = ["-p", "--no-session", "--model", f"{provider}/fake-model", "Look at how the tools are wired."]
    t0 = time.perf_counter()
    p = subprocess.Popen(pinned([*build.argv, *args], cpus), env=env, cwd=cwd, stdin=subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.stdout.read()
    peak_fp = peak_footprint_mb(p.pid)
    _, status, ru = os.wait4(p.pid, 0)
    wall = (time.perf_counter() - t0) * 1e3
    log = model.take_log()
    # Gaps: the end of a tool turn's message to the next request.
    gaps = [(b[1] - a[1]) * 1e3 for a, b in zip(log, log[1:]) if a[0] == "end" and b[0] == "request"]
    r = {"ok": os.waitstatus_to_exitcode(status) == 0 and DONE.encode() in out and len(gaps) == len(TURNS),
         "gap_ms": statistics.mean(gaps) if gaps else float("nan"), "wall_ms": wall,
         "cpu_ms": (ru.ru_utime + ru.ru_stime) * 1e3, "peak_mb": maxrss_mb(ru)}
    if peak_fp is not None:
        r.update(harness.last_exit_counters)
    if not r["ok"]:
        r["output"] = out.decode(errors="replace")[-2000:]
    return r


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build", action="append", required=True, help="name=command (repeatable)")
    ap.add_argument("--runs", type=int, default=11)
    ap.add_argument("--api", choices=["openai", "anthropic"], default="openai")
    ap.add_argument("--pace-ms", type=float, default=15, help="time between streamed chunks (default 15: ~65 tokens/s)")
    ap.add_argument("--words-after", type=int, default=40, help="text after the tool calls, in words (default 40; 0: none)")
    ap.add_argument("--cpus", help="pin Pi to these CPUs (taskset list)")
    ap.add_argument("--jsonl", help="append every run as a JSON line to this file")
    a = ap.parse_args()
    builds = parse_builds(a.build)
    model = Model(a.api, a.pace_ms / 1000, a.words_after)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(model))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    provider = "fake-anthropic" if a.api == "anthropic" else "fake"
    cwd = project_copy()
    results: dict[str, list[dict]] = {b.name: [] for b in builds}
    try:
        with pi_home(server.server_address[1]) as home:
            env = pi_env(home, {"TERM": "dumb"})
            for build in builds:  # warm-up
                run_once(build, model, env, cwd, provider, a.cpus)
            for i in range(a.runs):
                for build in builds:
                    r = run_once(build, model, env, cwd, provider, a.cpus)
                    if not r["ok"]:
                        print(f"{build.name}: run {i} FAILED\n{r.get('output', '')}", file=sys.stderr)
                    results[build.name].append(r)
                    if a.jsonl:
                        with open(a.jsonl, "a") as f:
                            f.write(json.dumps({"build": build.name, "api": a.api, "pace_ms": a.pace_ms,
                                                "words_after": a.words_after, **r}) + "\n")
    finally:
        server.shutdown()
        shutil.rmtree(cwd, ignore_errors=True)
    columns = ["gap_ms", "wall_ms", "cpu_ms", "peak_mb", "instr_m"]
    print(f"{a.api}, {a.pace_ms} ms per chunk, {a.words_after} words after the calls, {a.runs} runs, medians")
    print(f"{'build':12}" + "".join(f"{c:>11}" for c in columns) + "   ok")
    for name, runs in results.items():
        ok = [r for r in runs if r["ok"]]
        cells = [statistics.median(r[c] for r in ok) if ok and c in ok[0] else float("nan") for c in columns]
        print(f"{name:12}" + "".join(f"{v:11.1f}" for v in cells) + f"   {len(ok)}/{len(runs)}")


if __name__ == "__main__":
    main()
