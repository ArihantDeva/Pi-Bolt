import { readFileSync } from "node:fs";
import { parse as partialParse } from "partial-json";
import { describe, expect, it } from "vitest";
import { parseStreamingJson, parseStreamingJsonWhileStreaming, repairJson } from "../src/utils/json-parse.ts";

// parseStreamingJson() no longer repairs text that cannot be complete JSON, and parseStreamingJsonWhileStreaming() completes
// the start of an object or array itself instead of asking partial-json. Both must give what parseStreamingJson() gave
// before, below, for every prefix of every text: well-formed and malformed, fuzzed and real tool-call arguments.

function referenceParseJsonWithRepair<T>(json: string): T {
	try {
		return JSON.parse(json) as T;
	} catch (error) {
		const repairedJson = repairJson(json);
		if (repairedJson !== json) {
			return JSON.parse(repairedJson) as T;
		}
		throw error;
	}
}

function referenceParseStreamingJson<T = Record<string, unknown>>(partialJson: string | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}

	try {
		return referenceParseJsonWithRepair<T>(partialJson);
	} catch {
		try {
			const result = partialParse(partialJson);
			return (result ?? {}) as T;
		} catch {
			try {
				const result = partialParse(repairJson(partialJson));
				return (result ?? {}) as T;
			} catch {
				return {} as T;
			}
		}
	}
}

/** A string that tells apart everything two parse results may differ in: types, key order, prototypes, -0, NaN. */
function canonical(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value !== "object") return `${typeof value}:${String(value)}`;
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const proto = Object.getPrototypeOf(value);
	const protoTag = proto === Object.prototype ? "" : `proto=${canonical(proto)};`;
	const keys = Object.getOwnPropertyNames(value);
	return `{${protoTag}${keys.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function rng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

const STRING_PIECES = [
	"a",
	"hello world",
	" ",
	"  ",
	" ",
	" ",
	"　",
	"﻿",
	"é",
	"𝄞",
	"\ud83d",
	'"',
	"\\",
	"/",
	"\n",
	"\t",
	"\r\n",
	"\b\f",
	"\u0001",
	"{",
	"}",
	"[",
	"]",
	",",
	":",
	"true",
	"-1e5",
	"__proto__",
];

const KEYS = ["path", "content", "a", "b", "", "__proto__", "x y", "é", "0", "10", "constructor", "\n", '"q"'];

function randomString(random: () => number): string {
	let s = "";
	const n = Math.floor(random() * 5);
	for (let i = 0; i < n; i++) s += STRING_PIECES[Math.floor(random() * STRING_PIECES.length)];
	return s;
}

function randomValue(random: () => number, depth: number): unknown {
	const roll = random();
	if (depth > 3 || roll < 0.35) return randomString(random);
	if (roll < 0.45) return Math.floor(random() * 2000) - 1000;
	if (roll < 0.5) return [0, -0, 1.5, -2.25e-7, 1e21, 0.1, 123456789012][Math.floor(random() * 7)];
	if (roll < 0.58) return [true, false, null][Math.floor(random() * 3)];
	if (roll < 0.78) {
		const arr: unknown[] = [];
		const n = Math.floor(random() * 4);
		for (let i = 0; i < n; i++) arr.push(randomValue(random, depth + 1));
		return arr;
	}
	const entries: Array<[string, unknown]> = [];
	const n = Math.floor(random() * 4);
	for (let i = 0; i < n; i++) entries.push([KEYS[Math.floor(random() * KEYS.length)], randomValue(random, depth + 1)]);
	return entries;
}

/** Serializes randomValue()'s output (entry lists are objects, which may repeat keys) with random white space and escapes. */
function serialize(value: unknown, random: () => number): string {
	const ws = () => ["", "", "", " ", "\n", "\t", "\r\n  "][Math.floor(random() * 7)];
	const str = (s: string) => {
		let out = JSON.stringify(s);
		// Escape some characters that JSON.stringify writes as they are, as models do.
		if (random() < 0.3) out = out.replace(/[é/]/g, (c) => (c === "/" ? "\\/" : "\\u00e9"));
		return out;
	};
	if (typeof value === "string") return str(value);
	if (typeof value === "number") return random() < 0.1 && value === 1e21 ? "1E+21" : JSON.stringify(value);
	if (value === null || typeof value === "boolean") return String(value);
	if (
		Array.isArray(value) &&
		value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string") &&
		value.length > 0 &&
		random() < 0.999
	) {
		// Entry list: an object.
		return `{${ws()}${(value as Array<[string, unknown]>)
			.map(([key, v]) => `${str(key)}${ws()}:${ws()}${serialize(v, random)}`)
			.join(`${ws()},${ws()}`)}${ws()}}`;
	}
	if (Array.isArray(value)) return `[${ws()}${value.map((v) => serialize(v, random)).join(`${ws()},${ws()}`)}${ws()}]`;
	return "null";
}

function randomDocument(random: () => number): string {
	let value = randomValue(random, 0);
	if (typeof value !== "object" || value === null) value = [["content", value]];
	if (Array.isArray(value) && value.length === 0) value = random() < 0.5 ? [] : [["a", 1]];
	const text = serialize(value, random);
	return random() < 0.1 ? ` ${text}\n` : text;
}

function mutate(text: string, random: () => number): string {
	const chars = [...text];
	const n = 1 + Math.floor(random() * 3);
	for (let i = 0; i < n; i++) {
		const at = Math.floor(random() * (chars.length + 1));
		const piece = ['"', "\\", "{", "}", "[", "]", ",", ":", "x", " ", " ", "\n", "-", "0", "e", "."][
			Math.floor(random() * 16)
		];
		const op = random();
		if (op < 0.4) chars.splice(at, 0, piece);
		else if (op < 0.7) chars.splice(at, 1);
		else chars.splice(at, 1, piece);
	}
	return chars.join("");
}

/** Every prefix of `text` (with `stride` > 1, every stride-th and the last few), through both paths. */
function expectSameForPrefixes(text: string, stride = 1): number {
	const block = {};
	let checked = 0;
	const ends: number[] = [];
	for (let end = 0; end <= text.length; end += stride) ends.push(end);
	for (let end = Math.max(0, text.length - 8); end <= text.length; end++) ends.push(end);
	for (const end of ends) {
		const prefix = text.slice(0, end);
		const expected = canonical(referenceParseStreamingJson(prefix));
		// One block for every prefix: scanned on from where the last one ended.
		const incremental = canonical(parseStreamingJsonWhileStreaming(block, prefix, undefined));
		// A new block: scanned from the start.
		const fresh = canonical(parseStreamingJsonWhileStreaming({}, prefix, undefined));
		const stateless = canonical(parseStreamingJson(prefix));
		if (incremental !== expected || fresh !== expected || stateless !== expected) {
			expect({ prefix, incremental, fresh, stateless }).toEqual({
				prefix,
				incremental: expected,
				fresh: expected,
				stateless: expected,
			});
		}
		checked++;
	}
	return checked;
}

describe("streaming JSON parse matches the previous parseStreamingJson", () => {
	it("hand-picked texts", () => {
		const texts = [
			'{"path": "a.txt", "content": "line one\\nline \\"two\\" \\\\ \\u00e9 \\ud83d\\ude00 end"}',
			'{"a": [1, -2.5e+3, true, false, null, {"b": []}, [[], {}]], "c": {"d": "e"}}',
			'{"__proto__": {"x": 1}, "y": 2}',
			'{"\\u005f_proto__": 1}',
			'{"a": 1, "a": 2, "a": "three"}',
			'{"s": "trailing spaces     "}',
			'{"s": "raw\ncontrol"}',
			'{"s": "bad \\x escape"}',
			'{"n": 0, "m": -0, "o": 01}',
			'{"n": 1.}',
			'{"n": -}',
			'{"a": tru}',
			'{"a": nulx}',
			'[1, 2, [3, {"k": "v"}], "s"]',
			'{"a" 1}',
			'{"a":: 1}',
			'{"a": 1,, "b": 2}',
			'{"a": 1} trailing',
			'{"a": NaN, "b": Infinity, "c": -Infinity}',
			'  {"a": 1}  ',
			' {"a": 1}',
			'"just a string"',
			"123",
			'{"a": "\\',
			'{"a": "\\u12',
		];
		for (const text of texts) expectSameForPrefixes(text);
	});

	it("fuzzed well-formed documents, every prefix", () => {
		const random = rng(0xc0ffee);
		let checked = 0;
		for (let round = 0; round < 3000; round++) checked += expectSameForPrefixes(randomDocument(random));
		expect(checked).toBeGreaterThan(100_000);
	});

	it("fuzzed malformed documents, every prefix", () => {
		const random = rng(0xbad);
		for (let round = 0; round < 2000; round++) expectSameForPrefixes(mutate(randomDocument(random), random));
	});

	it("tool-call arguments with whole source files, as models stream them", () => {
		const files = [
			"../src/utils/json-parse.ts",
			"../src/api/openai-completions.ts",
			"../package.json",
			"../README.md",
		];
		for (const file of files) {
			const content = readFileSync(new URL(file, import.meta.url), "utf8");
			const compact = JSON.stringify({ path: file, content });
			const spaced = `{"path": ${JSON.stringify(file)}, "content": ${JSON.stringify(content)}, "mode": 420, "force": true}`;
			const edit = JSON.stringify({
				path: file,
				edits: [{ oldText: content.slice(0, 500), newText: content.slice(500, 900) }],
			});
			for (const text of [compact, spaced, edit]) {
				expectSameForPrefixes(text.slice(0, 3000));
				expectSameForPrefixes(text, Math.max(1, Math.floor(text.length / 400)));
			}
		}
	});

	it("is the same when the text is not a continuation of the previous one", () => {
		const block = {};
		for (const text of ['{"a": "xyz', '{"b": [1, 2', '{"a": "xy', '{"a": "xyz", "c": nu']) {
			expect(canonical(parseStreamingJsonWhileStreaming(block, text, undefined))).toBe(
				canonical(referenceParseStreamingJson(text)),
			);
		}
	});
});
