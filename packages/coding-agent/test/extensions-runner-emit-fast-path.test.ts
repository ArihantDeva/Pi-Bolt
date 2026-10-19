import { describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import type { ExtensionContext, ExtensionFactory } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";

async function createRunner(factories: ExtensionFactory[]): Promise<ExtensionRunner> {
	const runtime = createExtensionRuntime();
	const eventBus = createEventBus();
	const extensions = [];
	for (const factory of factories) {
		extensions.push(await loadExtensionFromFactory(factory, process.cwd(), eventBus, runtime));
	}
	const modelRegistry = await createInMemoryModelRegistry(AuthStorage.inMemory());
	return new ExtensionRunner(extensions, runtime, process.cwd(), SessionManager.inMemory(), modelRegistry);
}

describe("ExtensionRunner.emit without handlers", () => {
	it("returns undefined without building a context", async () => {
		const runner = await createRunner([
			(pi) => {
				pi.on("agent_end", () => {});
			},
		]);
		const createContext = vi.spyOn(runner, "createContext");
		const errors: unknown[] = [];
		runner.onError((error) => errors.push(error));

		await expect(runner.emit({ type: "agent_start" })).resolves.toBeUndefined();
		await expect(runner.emit({ type: "session_before_switch", reason: "new" })).resolves.toBeUndefined();
		expect(createContext).not.toHaveBeenCalled();
		expect(errors).toEqual([]);
	});

	it("returns undefined when there are no extensions", async () => {
		const runner = await createRunner([]);
		const createContext = vi.spyOn(runner, "createContext");
		await expect(runner.emit({ type: "agent_start" })).resolves.toBeUndefined();
		expect(createContext).not.toHaveBeenCalled();
	});
});

describe("ExtensionRunner.emit with handlers", () => {
	it("passes one context to every handler in order and returns the cancelling result", async () => {
		const calls: Array<{ name: string; ctx: ExtensionContext }> = [];
		const runner = await createRunner([
			(pi) => {
				pi.on("session_before_switch", (_event, ctx) => {
					calls.push({ name: "first", ctx });
					return undefined;
				});
			},
			(pi) => {
				pi.on("session_before_switch", (_event, ctx) => {
					calls.push({ name: "second", ctx });
					return { cancel: true };
				});
			},
			(pi) => {
				pi.on("session_before_switch", (_event, ctx) => {
					calls.push({ name: "third", ctx });
					return undefined;
				});
			},
		]);
		const createContext = vi.spyOn(runner, "createContext");

		const result = await runner.emit({ type: "session_before_switch", reason: "new" });

		expect(result).toEqual({ cancel: true });
		expect(createContext).toHaveBeenCalledTimes(1);
		expect(calls.map((call) => call.name)).toEqual(["first", "second"]);
		expect(calls[0].ctx).toBe(createContext.mock.results[0].value);
		expect(calls[1].ctx).toBe(calls[0].ctx);
	});

	it("reports handler errors and keeps calling later handlers", async () => {
		const seen: string[] = [];
		const runner = await createRunner([
			(pi) => {
				pi.on("agent_start", () => {
					throw new Error("boom");
				});
			},
			(pi) => {
				pi.on("agent_start", () => {
					seen.push("second");
				});
			},
		]);
		const errors: Array<{ event: string; error: string }> = [];
		runner.onError((error) => errors.push({ event: error.event, error: error.error }));

		await expect(runner.emit({ type: "agent_start" })).resolves.toBeUndefined();
		expect(seen).toEqual(["second"]);
		expect(errors).toEqual([{ event: "agent_start", error: "boom" }]);
	});
});

describe("ExtensionRunner.dispatch", () => {
	it("returns undefined without a context when no extension handles the event", async () => {
		const runner = await createRunner([
			(pi) => {
				pi.on("agent_end", () => {});
			},
		]);
		const createContext = vi.spyOn(runner, "createContext");
		expect(runner.dispatch({ type: "agent_start" })).toBeUndefined();
		expect(createContext).not.toHaveBeenCalled();
	});

	it("runs synchronous handlers to the end before returning, with one context", async () => {
		const calls: Array<{ name: string; ctx: ExtensionContext }> = [];
		const runner = await createRunner([
			(pi) => {
				pi.on("agent_start", (_event, ctx) => {
					calls.push({ name: "first", ctx });
				});
				pi.on("agent_start", (_event, ctx) => {
					calls.push({ name: "second", ctx });
				});
			},
			(pi) => {
				pi.on("agent_end", () => {});
			},
			(pi) => {
				pi.on("agent_start", (_event, ctx) => {
					calls.push({ name: "third", ctx });
				});
			},
		]);

		expect(runner.dispatch({ type: "agent_start" })).toBeUndefined();
		expect(calls.map((call) => call.name)).toEqual(["first", "second", "third"]);
		expect(new Set(calls.map((call) => call.ctx)).size).toBe(1);
	});

	it("waits for a handler's promise before calling the next handler, and reports every failure", async () => {
		const seen: string[] = [];
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const runner = await createRunner([
			(pi) => {
				pi.on("message_start", () => {
					seen.push("sync");
				});
				pi.on("message_start", () => {
					throw new Error("sync failure");
				});
				pi.on("message_start", async () => {
					seen.push("async start");
					await gate;
					seen.push("async end");
				});
			},
			(pi) => {
				pi.on("message_start", async () => {
					seen.push("rejecting");
					throw new Error("async failure");
				});
				pi.on("message_start", () => {
					seen.push("last");
				});
			},
		]);
		const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
		runner.onError((error) =>
			errors.push({ extensionPath: error.extensionPath, event: error.event, error: error.error }),
		);
		const [first, second] = runner.getExtensionPaths();

		const pending = runner.dispatch({
			type: "message_start",
			message: { role: "user", content: "hi", timestamp: 0 },
		});
		expect(pending).toBeInstanceOf(Promise);
		expect(seen).toEqual(["sync", "async start"]);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(seen).toEqual(["sync", "async start"]);

		release();
		await pending;
		expect(seen).toEqual(["sync", "async start", "async end", "rejecting", "last"]);
		expect(errors).toEqual([
			{ extensionPath: first, event: "message_start", error: "sync failure" },
			{ extensionPath: second, event: "message_start", error: "async failure" },
		]);
	});
});
