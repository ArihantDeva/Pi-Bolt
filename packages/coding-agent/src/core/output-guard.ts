interface StdoutTakeoverState {
	rawStdoutWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
	rawStderrWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
	originalStdoutWrite: typeof process.stdout.write;
}

let stdoutTakeoverState: StdoutTakeoverState | undefined;

const RAW_STDOUT_RETRY_DELAY_MS = 10;

/**
 * Output that may wait to be written before writers are held back (`waitForRawStdoutBackpressure`). Streaming writes a
 * line per event: holding the agent back for each line's write would cost a promise chain and an await per event.
 */
const RAW_STDOUT_HIGH_WATER_MARK = 64 * 1024;

/** Lines not written yet; they go out together, in order, with the next write. */
let rawStdoutQueue: string[] = [];
/** Characters queued or in flight. */
let rawStdoutPendingLength = 0;
let rawStdoutWriting = false;
/** A write of the queue is scheduled for when the current task ends. */
let rawStdoutScheduled = false;
let rawStdoutExitHookInstalled = false;
let rawStdoutDrainWaiters: Array<() => void> = [];

function getRawStdoutWrite(): StdoutTakeoverState["rawStdoutWrite"] {
	if (stdoutTakeoverState) {
		return stdoutTakeoverState.rawStdoutWrite;
	}
	return process.stdout.write.bind(process.stdout) as StdoutTakeoverState["rawStdoutWrite"];
}

async function writeRawStdoutChunk(text: string): Promise<void> {
	while (true) {
		try {
			await new Promise<void>((resolve, reject) => {
				try {
					getRawStdoutWrite()(text, (error) => {
						if (error) reject(error);
						else resolve();
					});
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
			return;
		} catch (error) {
			const writeError = error instanceof Error ? error : new Error(String(error));
			const code = (writeError as Error & { code?: unknown }).code;
			if (code !== "ENOBUFS" && code !== "EAGAIN" && code !== "EWOULDBLOCK") {
				throw writeError;
			}
			await new Promise<void>((resolve) => setTimeout(resolve, RAW_STDOUT_RETRY_DELAY_MS));
		}
	}
}

export function takeOverStdout(): void {
	if (stdoutTakeoverState) {
		return;
	}

	const rawStdoutWrite = process.stdout.write.bind(process.stdout) as StdoutTakeoverState["rawStdoutWrite"];
	const rawStderrWrite = process.stderr.write.bind(process.stderr) as StdoutTakeoverState["rawStderrWrite"];
	const originalStdoutWrite = process.stdout.write;

	process.stdout.write = ((
		chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
		callback?: (error?: Error | null) => void,
	): boolean => {
		if (typeof encodingOrCallback === "function") {
			return rawStderrWrite(String(chunk), encodingOrCallback);
		}
		return rawStderrWrite(String(chunk), callback);
	}) as typeof process.stdout.write;

	stdoutTakeoverState = {
		rawStdoutWrite,
		rawStderrWrite,
		originalStdoutWrite,
	};
}

export function restoreStdout(): void {
	if (!stdoutTakeoverState) {
		return;
	}

	process.stdout.write = stdoutTakeoverState.originalStdoutWrite;
	stdoutTakeoverState = undefined;
}

export function isStdoutTakenOver(): boolean {
	return stdoutTakeoverState !== undefined;
}

/**
 * Write `text` to the real stdout, after the lines written before it. The lines of one task (for example every event of
 * the stream chunks one network read delivered) go out together in one write when the task ends: JSON and RPC modes
 * write a line per streamed delta, and a write per line cost more than the rest of the delta's handling. One write is in
 * flight at a time; lines that arrive meanwhile are joined into the next one. A write that fails with
 * ENOBUFS/EAGAIN/EWOULDBLOCK is retried; any other failure exits the process.
 */
export function writeRawStdout(text: string): void {
	if (text.length === 0) {
		return;
	}
	rawStdoutQueue.push(text);
	rawStdoutPendingLength += text.length;
	if (!rawStdoutWriting && !rawStdoutScheduled) {
		rawStdoutScheduled = true;
		setImmediate(writeScheduledRawStdout);
		if (!rawStdoutExitHookInstalled) {
			rawStdoutExitHookInstalled = true;
			process.on("exit", writeQueuedRawStdoutAtExit);
		}
	}
}

function writeScheduledRawStdout(): void {
	rawStdoutScheduled = false;
	if (!rawStdoutWriting && rawStdoutQueue.length > 0) startRawStdoutWrite();
}

/** A process.exit() before the scheduled write still writes what was queued (after a write in flight, as streams do). */
function writeQueuedRawStdoutAtExit(): void {
	if (rawStdoutQueue.length === 0) return;
	const text = rawStdoutQueue.join("");
	rawStdoutQueue = [];
	rawStdoutPendingLength -= text.length;
	try {
		getRawStdoutWrite()(text);
	} catch {
		// Exiting anyway.
	}
}

function startRawStdoutWrite(): void {
	const text = rawStdoutQueue.length === 1 ? rawStdoutQueue[0] : rawStdoutQueue.join("");
	rawStdoutQueue = [];
	rawStdoutWriting = true;
	writeQueuedRawStdout(text);
}

function writeQueuedRawStdout(text: string): void {
	let settled = false;
	const onWritten = (error?: Error | null): void => {
		if (settled) return;
		settled = true;
		if (error) {
			const code = (error as Error & { code?: unknown }).code;
			if (code === "ENOBUFS" || code === "EAGAIN" || code === "EWOULDBLOCK") {
				setTimeout(() => writeQueuedRawStdout(text), RAW_STDOUT_RETRY_DELAY_MS);
				return;
			}
			queueMicrotask(() => process.exit(1));
			return;
		}
		rawStdoutPendingLength -= text.length;
		if (rawStdoutQueue.length > 0) {
			startRawStdoutWrite();
			return;
		}
		rawStdoutWriting = false;
		const waiters = rawStdoutDrainWaiters;
		rawStdoutDrainWaiters = [];
		for (const resolve of waiters) resolve();
	};
	try {
		getRawStdoutWrite()(text, onWritten);
	} catch (error) {
		onWritten(error instanceof Error ? error : new Error(String(error)));
	}
}

function waitForRawStdoutDrain(): Promise<void> {
	return new Promise((resolve) => rawStdoutDrainWaiters.push(resolve));
}

/**
 * Hold a writer back while more than the high-water mark of output waits to be written. Returns a promise that resolves
 * once everything queued so far is written, or undefined when the writer may go on right away.
 */
export function waitForRawStdoutBackpressure(): Promise<void> | undefined {
	return rawStdoutPendingLength > RAW_STDOUT_HIGH_WATER_MARK ? waitForRawStdoutDrain() : undefined;
}

/** Resolve once everything written so far has reached stdout. */
export async function flushRawStdout(): Promise<void> {
	if (rawStdoutScheduled) writeScheduledRawStdout();
	while (rawStdoutWriting) {
		await waitForRawStdoutDrain();
	}
	await writeRawStdoutChunk("");
}
