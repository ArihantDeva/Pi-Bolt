import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushRawStdout, waitForRawStdoutBackpressure, writeRawStdout } from "../src/core/output-guard.ts";

type WriteCallback = (error?: Error | null) => void;

/** Fake stdout writes: each call is recorded; the test decides when (and how) its callback fires. */
let writes: string[];
let pendingCallbacks: WriteCallback[];
let completeSynchronously: boolean;
let failNext: Error | undefined;
const originalWrite = process.stdout.write;

const nextTask = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
	writes = [];
	pendingCallbacks = [];
	completeSynchronously = true;
	failNext = undefined;
	process.stdout.write = ((chunk: string, callback?: WriteCallback) => {
		writes.push(chunk);
		const error = failNext;
		failNext = undefined;
		if (completeSynchronously || error) callback?.(error);
		else if (callback) pendingCallbacks.push(callback);
		return true;
	}) as typeof process.stdout.write;
});

afterEach(async () => {
	completeSynchronously = true;
	for (const callback of pendingCallbacks.splice(0)) callback();
	await flushRawStdout();
	process.stdout.write = originalWrite;
});

describe("writeRawStdout", () => {
	it("writes the lines of a task together, in order, once the task ends", async () => {
		writeRawStdout("a\n");
		writeRawStdout("");
		writeRawStdout("b\n");
		expect(writes).toEqual([]);
		await nextTask();
		expect(writes).toEqual(["a\nb\n"]);
	});

	it("keeps one write in flight and joins the lines that arrive meanwhile", async () => {
		completeSynchronously = false;
		writeRawStdout("a\n");
		await nextTask();
		expect(writes).toEqual(["a\n"]);
		writeRawStdout("b\n");
		writeRawStdout("c\n");
		await nextTask();
		expect(writes).toEqual(["a\n"]);
		pendingCallbacks.shift()?.();
		expect(writes).toEqual(["a\n", "b\nc\n"]);
	});

	it("retries a write that failed with EAGAIN, before later lines", async () => {
		failNext = Object.assign(new Error("try again"), { code: "EAGAIN" });
		writeRawStdout("a\n");
		await nextTask();
		writeRawStdout("b\n");
		expect(writes).toEqual(["a\n"]);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(writes).toEqual(["a\n", "a\n", "b\n"]);
	});

	it("writes what is queued when the process exits before the scheduled write", () => {
		writeRawStdout("last\n");
		const exitHook = process.listeners("exit").find((listener) => listener.name === "writeQueuedRawStdoutAtExit");
		expect(exitHook).toBeDefined();
		exitHook?.(0);
		expect(writes).toEqual(["last\n"]);
	});
});

describe("waitForRawStdoutBackpressure", () => {
	it("lets writers go on while less than the high-water mark waits", async () => {
		completeSynchronously = false;
		writeRawStdout("small\n");
		expect(waitForRawStdoutBackpressure()).toBeUndefined();
		await nextTask();
		expect(waitForRawStdoutBackpressure()).toBeUndefined();
	});

	it("holds writers back until a large backlog is written", async () => {
		completeSynchronously = false;
		writeRawStdout(`${"x".repeat(70 * 1024)}\n`);
		const wait = waitForRawStdoutBackpressure();
		expect(wait).toBeInstanceOf(Promise);
		let released = false;
		void wait?.then(() => {
			released = true;
		});
		await nextTask();
		expect(writes).toHaveLength(1);
		expect(released).toBe(false);
		pendingCallbacks.shift()?.();
		await wait;
		expect(released).toBe(true);
		expect(waitForRawStdoutBackpressure()).toBeUndefined();
	});
});

describe("flushRawStdout", () => {
	it("writes queued lines right away and resolves after they are written", async () => {
		writeRawStdout("a\n");
		writeRawStdout("b\n");
		await flushRawStdout();
		expect(writes).toEqual(["a\nb\n", ""]);
	});
});
