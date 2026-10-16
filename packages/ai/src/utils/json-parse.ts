import { parse as partialParse } from "partial-json";
import type { ToolCall } from "../types.ts";

const VALID_JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

function escapeControlCharacter(char: string): string {
	switch (char) {
		case "\b":
			return "\\b";
		case "\f":
			return "\\f";
		case "\n":
			return "\\n";
		case "\r":
			return "\\r";
		case "\t":
			return "\\t";
		default:
			return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
	}
}

/**
 * Repairs malformed JSON string literals by:
 * - escaping raw control characters inside strings
 * - doubling backslashes before invalid escape characters
 *
 * Returns `json` itself when nothing needs repair. Unchanged runs are copied with slice() rather than one character at a
 * time: streamed tool-call arguments, often a whole file, come through here each time they are parsed.
 */
export function repairJson(json: string): string {
	let repaired = "";
	// Start of the run of characters that has not been copied to `repaired` yet.
	let runStart = 0;
	let inString = false;

	for (let index = 0; index < json.length; index++) {
		const code = json.charCodeAt(index);

		if (!inString) {
			if (code === 0x22) {
				inString = true;
			}
			continue;
		}

		if (code === 0x22) {
			inString = false;
			continue;
		}

		if (code === 0x5c) {
			const nextChar = json[index + 1];
			// "\u" is an escape only with four hex digits after it; "\url" is text (#10868).
			if (
				nextChar === "u" ? isHexQuad(json, index + 2) : nextChar !== undefined && VALID_JSON_ESCAPES.has(nextChar)
			) {
				index += nextChar === "u" ? 5 : 1;
				continue;
			}
			repaired += `${json.slice(runStart, index)}\\\\`;
			runStart = index + 1;
			continue;
		}

		if (code <= 0x1f) {
			repaired += json.slice(runStart, index) + escapeControlCharacter(json[index]);
			runStart = index + 1;
		}
	}

	return runStart === 0 ? json : repaired + json.slice(runStart);
}

/** Whether the four characters of `json` at `start` are hex digits. */
function isHexQuad(json: string, start: number): boolean {
	if (start + 4 > json.length) return false;
	for (let i = start; i < start + 4; i++) {
		const code = json.charCodeAt(i) | 0x20;
		if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) return false;
	}
	return true;
}

export function parseJsonWithRepair<T>(json: string): T {
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

/** Whether `json` could be a complete JSON value after repairJson(): an object must end with "}", an array with "]". */
function mayBeCompleteJson(json: string): boolean {
	let first = 0;
	while (first < json.length && isJsonWhitespace(json.charCodeAt(first))) first++;
	const open = json.charCodeAt(first);
	if (open !== 0x7b && open !== 0x5b) return true;
	let last = json.length - 1;
	while (last > first && isJsonWhitespace(json.charCodeAt(last))) last--;
	// repairJson() changes only what is inside strings, so the first and last characters outside them stay.
	return json.charCodeAt(last) === (open === 0x7b ? 0x7d : 0x5d);
}

function isJsonWhitespace(code: number): boolean {
	return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
}

function parseStreamingJsonWith<T>(partialJson: string | undefined, scan: PartialJsonScan | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}

	try {
		return JSON.parse(partialJson) as T;
	} catch {
		// Incomplete JSON is the common case while streaming: it stays incomplete when repaired, so it is not repaired.
		if (mayBeCompleteJson(partialJson)) {
			const repairedJson = repairJson(partialJson);
			if (repairedJson !== partialJson) {
				try {
					return JSON.parse(repairedJson) as T;
				} catch {}
			}
		}
	}

	if (scan) {
		const completed = parsePartialJsonPrefix<T>(scan, partialJson);
		if (completed !== undefined) return completed;
	}
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

/**
 * Parses the model's complete arguments text of a finished tool call.
 *
 * Unlike {@link parseStreamingJson}, this never keeps a partially parsed prefix: once the call is
 * finished, text that is not a valid JSON object means the model sent malformed arguments. In that
 * case `arguments` is `{}` and `argumentsError` describes the problem, including the text the
 * model sent, so tool validation can report it back to the model.
 */
export function parseToolCallArguments(json: string | undefined): Pick<ToolCall, "arguments" | "argumentsError"> {
	if (!json?.trim()) return { arguments: {} };
	try {
		const parsed = parseJsonWithRepair<ToolCall["arguments"] | null>(json);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("Tool arguments must be a JSON object");
		}
		return { arguments: parsed };
	} catch (error) {
		return {
			arguments: {},
			argumentsError: `${error instanceof Error ? error.message : String(error)}\n\nReceived arguments:\n${json}`,
		};
	}
}

/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Always returns a valid object, even if the JSON is incomplete.
 *
 * @param partialJson The partial JSON string from streaming
 * @returns Parsed object or empty object if parsing fails
 */
export function parseStreamingJson<T = Record<string, unknown>>(partialJson: string | undefined): T {
	return parseStreamingJsonWith<T>(partialJson, undefined);
}

// Scanner states. VALUE: a value is expected (after ":" or after "," in an array). ARRAY_FIRST, OBJECT_FIRST: after "[", "{".
// OBJECT_KEY: after "," in an object. AFTER_KEY: a ":" is expected. AFTER_VALUE: "," or the end of the container is expected.
const VALUE = 0;
const ARRAY_FIRST = 1;
const OBJECT_FIRST = 2;
const OBJECT_KEY = 3;
const KEY_STRING = 4;
const AFTER_KEY = 5;
const VALUE_STRING = 6;
const NUMBER = 7;
const LITERAL = 8;
const AFTER_VALUE = 9;
const DONE = 10;
// After "[" and white space. partial-json does not skip white space between "[" and "]": it reads "[ ]" wrongly, and what
// follows with it, so such a text is left to it.
const ARRAY_FIRST_SPACED = 11;

// Number states: after "-", after a leading "0", in the integer digits, after ".", in the fraction, after "e", after the
// exponent's sign, in the exponent digits.
const NUMBER_MINUS = 0;
const NUMBER_ZERO = 1;
const NUMBER_INTEGER = 2;
const NUMBER_DOT = 3;
const NUMBER_FRACTION = 4;
const NUMBER_E = 5;
const NUMBER_E_SIGN = 6;
const NUMBER_EXPONENT = 7;

/**
 * What a scan of the start of a streamed JSON text found, so that the next, longer text is scanned only from where this
 * one ended: the containers open at the end, and for each where its last complete member ends.
 */
interface PartialJsonScan {
	text: string;
	/** The text so far is the start of a JSON object or array (`false` also when this cannot tell). */
	valid: boolean;
	/** A key that may be "__proto__", which partial-json sets as the object's prototype rather than as a property. */
	protoKey: boolean;
	state: number;
	/** 0x7d ("}") for an open object, 0x5d ("]") for an open array, innermost last. */
	closers: number[];
	/** For each open container, the index just after its opening bracket or its last complete member. */
	committed: number[];
	stringStart: number;
	/** Index of the backslash of an escape that is not complete yet, or -1. */
	escapeStart: number;
	/** Hex digits still to come in a \u escape. */
	hexLeft: number;
	keyHasEscape: boolean;
	literal: string;
	literalIndex: number;
	numberState: number;
}

function createPartialJsonScan(): PartialJsonScan {
	return {
		text: "",
		valid: true,
		protoKey: false,
		state: VALUE,
		closers: [],
		committed: [],
		stringStart: 0,
		escapeStart: -1,
		hexLeft: 0,
		keyHasEscape: false,
		literal: "",
		literalIndex: 0,
		numberState: NUMBER_MINUS,
	};
}

function isHexDigit(code: number): boolean {
	return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

function isNumberComplete(numberState: number): boolean {
	return (
		numberState === NUMBER_ZERO ||
		numberState === NUMBER_INTEGER ||
		numberState === NUMBER_FRACTION ||
		numberState === NUMBER_EXPONENT
	);
}

/** Whether String.prototype.trim() removes the character `code`. */
function isTrimmedByTrim(code: number): boolean {
	return (
		(code >= 0x09 && code <= 0x0d) ||
		code === 0x20 ||
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}

/** Continues `scan` over `text` from `start`. Clears `scan.valid` at the first character that cannot follow. */
function scanPartialJson(scan: PartialJsonScan, text: string, start: number): void {
	let i = start;
	const length = text.length;
	// Index of the next quote and backslash at or after i; -2 when not searched yet, -1 when there is none.
	let nextQuote = -2;
	let nextBackslash = -2;
	const endValue = (end: number) => {
		if (scan.closers.length === 0) {
			scan.state = DONE;
		} else {
			scan.committed[scan.committed.length - 1] = end;
			scan.state = AFTER_VALUE;
		}
	};
	while (i < length) {
		const state = scan.state;
		if (state === KEY_STRING || state === VALUE_STRING) {
			if (scan.escapeStart !== -1) {
				const code = text.charCodeAt(i);
				if (scan.hexLeft > 0) {
					if (!isHexDigit(code)) {
						scan.valid = false;
						return;
					}
					scan.hexLeft--;
					if (scan.hexLeft === 0) scan.escapeStart = -1;
				} else if (code === 0x75) {
					scan.hexLeft = 4;
				} else if (
					code === 0x22 ||
					code === 0x5c ||
					code === 0x2f ||
					code === 0x62 ||
					code === 0x66 ||
					code === 0x6e ||
					code === 0x72 ||
					code === 0x74
				) {
					scan.escapeStart = -1;
				} else {
					scan.valid = false;
					return;
				}
				i++;
				continue;
			}
			// Only a quote or a backslash changes anything inside a string; raw control characters, which JSON does not
			// allow there, make JSON.parse() of the completed text fail (parsePartialJsonPrefix). Where the next of each
			// is stays known until it is passed: searching for both again after every escape made a long string with many
			// escapes quadratic.
			if (nextQuote !== -1 && nextQuote < i) nextQuote = text.indexOf('"', i);
			if (nextBackslash !== -1 && nextBackslash < i) nextBackslash = text.indexOf("\\", i);
			const quote = nextQuote;
			const backslash = nextBackslash !== -1 && (quote === -1 || nextBackslash < quote) ? nextBackslash : -1;
			if (backslash !== -1) {
				scan.escapeStart = backslash;
				if (state === KEY_STRING) scan.keyHasEscape = true;
				i = backslash + 1;
				continue;
			}
			if (quote === -1) {
				i = length;
				break;
			}
			if (state === KEY_STRING) {
				if (
					scan.keyHasEscape ||
					(quote - scan.stringStart === 10 && text.startsWith("__proto__", scan.stringStart + 1))
				) {
					scan.protoKey = true;
				}
				scan.state = AFTER_KEY;
			} else {
				endValue(quote + 1);
			}
			i = quote + 1;
			continue;
		}

		const code = text.charCodeAt(i);
		if (state === NUMBER) {
			const numberState = scan.numberState;
			const isDigit = code >= 0x30 && code <= 0x39;
			if (isDigit) {
				if (numberState === NUMBER_MINUS) scan.numberState = code === 0x30 ? NUMBER_ZERO : NUMBER_INTEGER;
				else if (numberState === NUMBER_ZERO) {
					scan.valid = false;
					return;
				} else if (numberState === NUMBER_DOT) scan.numberState = NUMBER_FRACTION;
				else if (numberState === NUMBER_E || numberState === NUMBER_E_SIGN) scan.numberState = NUMBER_EXPONENT;
				i++;
				continue;
			}
			if (code === 0x2e && (numberState === NUMBER_ZERO || numberState === NUMBER_INTEGER)) {
				scan.numberState = NUMBER_DOT;
				i++;
				continue;
			}
			if (
				(code === 0x65 || code === 0x45) &&
				(numberState === NUMBER_ZERO || numberState === NUMBER_INTEGER || numberState === NUMBER_FRACTION)
			) {
				scan.numberState = NUMBER_E;
				i++;
				continue;
			}
			if ((code === 0x2b || code === 0x2d) && numberState === NUMBER_E) {
				scan.numberState = NUMBER_E_SIGN;
				i++;
				continue;
			}
			if (!isNumberComplete(numberState)) {
				scan.valid = false;
				return;
			}
			// The character after the number is looked at again as what follows a value.
			endValue(i);
			continue;
		}
		if (state === LITERAL) {
			if (code !== scan.literal.charCodeAt(scan.literalIndex)) {
				scan.valid = false;
				return;
			}
			scan.literalIndex++;
			i++;
			if (scan.literalIndex === scan.literal.length) endValue(i);
			continue;
		}

		i++;
		if (isJsonWhitespace(code)) {
			if (state === ARRAY_FIRST) scan.state = ARRAY_FIRST_SPACED;
			continue;
		}
		if (state === VALUE || state === ARRAY_FIRST || state === ARRAY_FIRST_SPACED) {
			if (code === 0x5d && state === ARRAY_FIRST_SPACED) {
				scan.valid = false;
				return;
			}
			if (code === 0x5d && state === ARRAY_FIRST) {
				scan.closers.pop();
				scan.committed.pop();
				endValue(i);
			} else if (code === 0x7b || code === 0x5b) {
				scan.closers.push(code === 0x7b ? 0x7d : 0x5d);
				scan.committed.push(i);
				scan.state = code === 0x7b ? OBJECT_FIRST : ARRAY_FIRST;
			} else if (scan.closers.length === 0) {
				// Only an object or an array is completed; partial-json reads anything else.
				scan.valid = false;
				return;
			} else if (code === 0x22) {
				scan.stringStart = i - 1;
				scan.state = VALUE_STRING;
			} else if (code === 0x2d || (code >= 0x30 && code <= 0x39)) {
				scan.numberState = code === 0x2d ? NUMBER_MINUS : code === 0x30 ? NUMBER_ZERO : NUMBER_INTEGER;
				scan.state = NUMBER;
			} else if (code === 0x74 || code === 0x66 || code === 0x6e) {
				scan.literal = code === 0x74 ? "true" : code === 0x66 ? "false" : "null";
				scan.literalIndex = 1;
				scan.state = LITERAL;
			} else {
				scan.valid = false;
				return;
			}
		} else if (state === OBJECT_FIRST || state === OBJECT_KEY) {
			if (code === 0x7d && state === OBJECT_FIRST) {
				scan.closers.pop();
				scan.committed.pop();
				endValue(i);
			} else if (code === 0x22) {
				scan.stringStart = i - 1;
				scan.keyHasEscape = false;
				scan.state = KEY_STRING;
			} else {
				scan.valid = false;
				return;
			}
		} else if (state === AFTER_KEY) {
			if (code !== 0x3a) {
				scan.valid = false;
				return;
			}
			scan.state = VALUE;
		} else if (state === AFTER_VALUE) {
			const closer = scan.closers[scan.closers.length - 1];
			if (code === 0x2c) {
				scan.state = closer === 0x7d ? OBJECT_KEY : VALUE;
			} else if (code === closer) {
				scan.closers.pop();
				scan.committed.pop();
				endValue(i);
			} else {
				scan.valid = false;
				return;
			}
		} else {
			// DONE: JSON.parse() would have read the text, unless something follows the value.
			scan.valid = false;
			return;
		}
	}
}

/**
 * What partial-json's parse() returns for `text`, computed by closing what is open at its end and handing that to
 * JSON.parse(), for a text that is the start of a JSON object or array; `undefined` for any other text, which is left to
 * partial-json. The text is scanned from where the scan of the previous text ended when it starts with that text, so a
 * tool call's arguments are scanned once however often they are parsed while they stream in.
 *
 * partial-json, given the start of a JSON object or array (after trim()), returns the members and elements that are
 * complete; a string that is still open, without a trailing incomplete escape; an open object or array, completed the
 * same way; and the rest of a literal (`tr` is `true`). It leaves out a key whose value has not started. A number still
 * at the end it reads only when it is a complete number, so other numbers there are left to it.
 */
function parsePartialJsonPrefix<T>(scan: PartialJsonScan, text: string): T | undefined {
	if (scan.text.length > 0 && text.length >= scan.text.length && text.startsWith(scan.text)) {
		// A text that starts with one that is not the start of a JSON object or array is not one either.
		if (scan.valid) scanPartialJson(scan, text, scan.text.length);
	} else {
		Object.assign(scan, createPartialJsonScan());
		scanPartialJson(scan, text, 0);
	}
	scan.text = text;
	if (!scan.valid || scan.protoKey || scan.closers.length === 0) return undefined;

	let completed: string;
	const state = scan.state;
	if (state === AFTER_VALUE) {
		completed = text;
	} else if (state === LITERAL) {
		completed = text + scan.literal.slice(scan.literalIndex);
	} else if (state === NUMBER) {
		if (!isNumberComplete(scan.numberState)) return undefined;
		completed = text;
	} else if (state === VALUE_STRING) {
		// partial-json trims the text first, which takes white space off the end of a string that is still open.
		let end = text.length;
		while (end > scan.stringStart + 1 && isTrimmedByTrim(text.charCodeAt(end - 1))) end--;
		if (end < text.length) completed = `${text.slice(0, end)}"`;
		else if (scan.escapeStart !== -1) completed = `${text.slice(0, scan.escapeStart)}"`;
		else completed = `${text}"`;
	} else {
		// After "[" or "{", or in a member or element that has not got to its value: up to the last complete one.
		completed = text.slice(0, scan.committed[scan.committed.length - 1]);
	}
	for (let level = scan.closers.length - 1; level >= 0; level--) {
		completed += scan.closers[level] === 0x7d ? "}" : "]";
	}
	try {
		return JSON.parse(completed) as T;
	} catch {
		return undefined;
	}
}

const lengthsParsedWhileStreaming = new WeakMap<object, number>();
const scansWhileStreaming = new WeakMap<object, PartialJsonScan>();

/**
 * Arguments of a tool call that are still streaming in, for showing them as they arrive: parsed again on every delta while
 * shorter than 1 KB, and after that once they have grown by an eighth since `block`'s were last parsed; otherwise `current` is
 * kept. Parsing all that
 * has arrived on every delta made streaming a large argument, such as a whole file passed to a write tool, quadratic in its size.
 * The final arguments are parsed with parseStreamingJson() once the tool call is complete.
 *
 * Incomplete arguments are parsed by closing what is open at their end and handing that to JSON.parse()
 * (parsePartialJsonPrefix), which gives what parseStreamingJson() gives, rather than by partial-json's parser, which looks at
 * every character in JavaScript.
 */
export function parseStreamingJsonWhileStreaming<T = Record<string, unknown>>(
	block: object,
	partialJson: string | undefined,
	current: T | undefined,
): T {
	const length = partialJson?.length ?? 0;
	const parsed = lengthsParsedWhileStreaming.get(block);
	if (current !== undefined && parsed !== undefined && length - parsed < (parsed < 1024 ? 1 : parsed >> 3)) {
		return current;
	}
	lengthsParsedWhileStreaming.set(block, length);
	let scan = scansWhileStreaming.get(block);
	if (!scan) {
		scan = createPartialJsonScan();
		scansWhileStreaming.set(block, scan);
	}
	return parseStreamingJsonWith<T>(partialJson, scan);
}
