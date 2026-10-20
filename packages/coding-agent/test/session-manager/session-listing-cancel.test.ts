import { mkdtempSync, rmSync } from "fs";
import * as fsPromises from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

// The listing's index write, held open by the test.
const indexWrite = vi.hoisted(() => ({
	started: undefined as (() => void) | undefined,
	release: undefined as Promise<void> | undefined,
}));

vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof fsPromises>();
	return {
		...actual,
		writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
			if (String(args[0]).includes(".session-index.json")) {
				indexWrite.started?.();
				await indexWrite.release;
			}
			return actual.writeFile(...args);
		},
	};
});

describe("session listing cancelled while it writes its index", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-listing-cancel-"));
	});

	afterEach(() => {
		indexWrite.started = undefined;
		indexWrite.release = undefined;
		rmSync(dir, { recursive: true, force: true });
	});

	it("rejects without waiting for the write, which still completes", async () => {
		const session = SessionManager.create(dir, dir);
		session.appendMessage(userMsg("question"));
		session.appendMessage(assistantMsg("answer"));

		let release!: () => void;
		indexWrite.release = new Promise((resolve) => {
			release = resolve;
		});
		const controller = new AbortController();
		indexWrite.started = () => controller.abort();

		await expect(SessionManager.listAll(dir, undefined, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		release();
		await vi.waitFor(async () => {
			const index = JSON.parse(await fsPromises.readFile(join(dir, ".session-index.json"), "utf8"));
			expect(Object.keys(index.sessions)).toEqual([session.getSessionFile()]);
		});
		const [info] = await SessionManager.listAll(dir);
		expect(info?.messageCount).toBe(2);
	});
});
