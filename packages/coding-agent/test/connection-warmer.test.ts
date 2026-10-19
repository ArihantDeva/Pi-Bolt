import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { ConnectionWarmer, preconnectOrigin, runtimePreconnect } from "../src/core/connection-warmer.ts";

function model(api: string, baseUrl: string): Model<Api> {
	return {
		id: "m",
		name: "M",
		api,
		provider: "p",
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 1_000,
	} as Model<Api>;
}

const anthropic = model("anthropic-messages", "https://api.anthropic.com");

function setup() {
	let now = 1_000_000;
	const preconnect = vi.fn<(url: string) => void>();
	const warmer = new ConnectionWarmer({ preconnect, now: () => now, idleMs: 10_000 });
	return {
		warmer,
		preconnect,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("preconnectOrigin", () => {
	it("is the HTTPS origin of an API whose requests go to the model's baseUrl", () => {
		expect(preconnectOrigin(anthropic)).toBe("https://api.anthropic.com");
		expect(preconnectOrigin(model("openai-completions", "https://api.example.com:8443/v1"))).toBe(
			"https://api.example.com:8443",
		);
		expect(preconnectOrigin(model("openai-responses", "https://api.openai.com/v1"))).toBe("https://api.openai.com");
	});

	it("is undefined for other APIs, plain HTTP, a bad URL, no model", () => {
		expect(
			preconnectOrigin(model("google-generative-ai", "https://generativelanguage.googleapis.com")),
		).toBeUndefined();
		expect(preconnectOrigin(model("openai-codex-responses", "https://chatgpt.com/backend-api"))).toBeUndefined();
		expect(preconnectOrigin(model("openai-completions", "http://127.0.0.1:8080/v1"))).toBeUndefined();
		expect(preconnectOrigin(model("openai-completions", "not a url"))).toBeUndefined();
		expect(preconnectOrigin(undefined)).toBeUndefined();
	});
});

describe("ConnectionWarmer", () => {
	it("preconnects when a prompt is started, then once per idle period", () => {
		const { warmer, preconnect, advance } = setup();
		warmer.onTyping("h", anthropic);
		warmer.onTyping("he", anthropic);
		expect(preconnect).toHaveBeenCalledExactlyOnceWith("https://api.anthropic.com");
		// The prompt is sent and answered: activity.
		warmer.markActivity();
		advance(9_000);
		warmer.onTyping("n", anthropic);
		expect(preconnect).toHaveBeenCalledOnce();
		advance(1_000);
		warmer.onTyping("ne", anthropic);
		expect(preconnect).toHaveBeenCalledTimes(2);
		// Still typing: the next only after another idle period.
		advance(5_000);
		warmer.onTyping("nex", anthropic);
		expect(preconnect).toHaveBeenCalledTimes(2);
		advance(5_000);
		warmer.onTyping("next", anthropic);
		expect(preconnect).toHaveBeenCalledTimes(3);
	});

	it("does not preconnect for an empty editor, a command, a shell command, or a model it cannot help", () => {
		const { warmer, preconnect } = setup();
		for (const text of ["", "   ", "/model", " /compact", "!ls", "!!ls"]) warmer.onTyping(text, anthropic);
		warmer.onTyping("hello", model("openai-completions", "http://localhost:11434/v1"));
		warmer.onTyping("hello", undefined);
		expect(preconnect).not.toHaveBeenCalled();
		// None of that used up the idle period.
		warmer.onTyping("hello", anthropic);
		expect(preconnect).toHaveBeenCalledOnce();
	});

	it("does nothing without a runtime preconnect, and survives one that throws", () => {
		const none = new ConnectionWarmer({ preconnect: undefined });
		expect(() => none.onTyping("hello", anthropic)).not.toThrow();
		const throwing = new ConnectionWarmer({
			preconnect: () => {
				throw new Error("no");
			},
		});
		expect(() => throwing.onTyping("hello", anthropic)).not.toThrow();
	});

	it("uses fetch.preconnect where the runtime has it", () => {
		const preconnect = vi.fn();
		vi.stubGlobal(
			"fetch",
			Object.assign(() => undefined, { preconnect }),
		);
		try {
			runtimePreconnect()?.("https://api.anthropic.com");
			expect(preconnect).toHaveBeenCalledExactlyOnceWith("https://api.anthropic.com");
			vi.stubGlobal("fetch", () => undefined);
			expect(runtimePreconnect()).toBeUndefined();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
