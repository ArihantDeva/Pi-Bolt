import { afterEach, describe, expect, it, vi } from "vitest";
import { markCachedString, stringifyRequestBody } from "../src/utils/request-json.ts";

function rng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

const long = (seed: string) => `${seed} "q" \\ \n\t\u0001 é 𝄞 \ud800 ${"x".repeat(1100)}`;

function randomLeaf(random: () => number): unknown {
	const leaves = [
		() => long(String(random())),
		() => "short",
		() => Math.floor(random() * 100) - 50,
		() => Number.NaN,
		() => -0,
		() => Number.POSITIVE_INFINITY,
		() => true,
		() => null,
		() => undefined,
		() => () => 1,
		() => Symbol("s"),
		() => new Date(0),
		() => new Number(3),
		() => new String("boxed"),
		() => ({ toJSON: (key: string) => `json:${key}` }),
		() => Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } }),
	];
	return leaves[Math.floor(random() * leaves.length)]();
}

/** A random body with marked strings; returns the body. */
function randomBody(random: () => number, keys: object[]): Record<string, unknown> {
	const messages: unknown[] = [];
	const body: Record<string, unknown> = { model: "m", messages, stream: true };
	for (let i = 0; i < 6; i++) {
		const message: Record<string, unknown> = { role: "tool" };
		const content = random() < 0.8 ? long(`content ${i}`) : randomLeaf(random);
		message.content = content;
		if (random() < 0.5) message.extra = randomLeaf(random);
		if (random() < 0.3) message.nested = { a: randomLeaf(random), b: [randomLeaf(random), randomLeaf(random)] };
		const toolCall = { id: "t", function: { name: "f", arguments: long(`args ${i}`) } };
		const toolCalls = [toolCall];
		if (random() < 0.5) message.tool_calls = toolCalls;
		const key = keys[i % keys.length];
		if (typeof content === "string") markCachedString(message, "content", content, key, messages);
		markCachedString(
			toolCall.function,
			"arguments",
			toolCall.function.arguments,
			keys[(i + 1) % keys.length],
			messages,
			message,
			toolCalls,
			toolCall,
		);
		if (random() < 0.1) messages.push(undefined);
		messages.push(message);
	}
	if (random() < 0.2) body.top = randomLeaf(random);
	return body;
}

function expectSame(body: object): void {
	let expected: string | undefined;
	let threw = false;
	try {
		expected = JSON.stringify(body);
	} catch {
		threw = true;
	}
	const actual = stringifyRequestBody(body);
	// `undefined`: left to JSON.stringify by the caller.
	if (actual !== undefined) expect(actual).toBe(expected);
	if (threw) expect(actual).toBeUndefined();
}

describe("stringifyRequestBody", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("gives what JSON.stringify gives for fuzzed bodies, with and without cached strings", () => {
		const random = rng(1234);
		const keys = Array.from({ length: 5 }, () => ({}));
		let serialized = 0;
		for (let round = 0; round < 3000; round++) {
			const body = randomBody(random, keys);
			expectSame(body);
			if (stringifyRequestBody(body) !== undefined) serialized++;
		}
		// Most bodies are written by it, not left to JSON.stringify.
		expect(serialized).toBeGreaterThan(1500);
	});

	it("leaves a body to the caller when a member has toJSON or cannot be serialized", () => {
		expect(stringifyRequestBody({ a: { toJSON: () => 1 } })).toBeUndefined();
		expect(stringifyRequestBody({ toJSON: () => 1 })).toBeUndefined();
		expect(stringifyRequestBody({ a: BigInt(1) })).toBeUndefined();
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(stringifyRequestBody({ cyclic })).toBeUndefined();
	});

	it("escapes a marked string once while it is unchanged, and again when it changes", () => {
		const key = {};
		const text = long("cached");
		const stringify = vi.spyOn(JSON, "stringify");
		const send = (value: string) => {
			const messages: unknown[] = [];
			const message = { role: "tool", content: value };
			markCachedString(message, "content", value, key, messages);
			messages.push(message);
			return stringifyRequestBody({ messages });
		};
		const first = send(text);
		const second = send(text);
		const calls = (value: string) => stringify.mock.calls.filter((call) => call[0] === value).length;
		expect(second).toBe(first);
		expect(calls(text)).toBe(1);
		const changed = `${text}!`;
		expect(send(changed)).toBe(JSON.stringify({ messages: [{ role: "tool", content: changed }] }));
		expect(calls(changed)).toBe(1);
	});

	it("drops a cached string that no request has used for a while", () => {
		const key = {};
		const text = long("evicted");
		const stringify = vi.spyOn(JSON, "stringify");
		const send = (value: string, cacheKey: object) => {
			const messages: unknown[] = [];
			const message = { role: "tool", content: value };
			markCachedString(message, "content", value, cacheKey, messages);
			messages.push(message);
			return stringifyRequestBody({ messages });
		};
		send(text, key);
		for (let i = 0; i < 20; i++) send(long(`other ${i}`), {});
		send(text, key);
		expect(stringify.mock.calls.filter((call) => call[0] === text)).toHaveLength(2);
	});
});
