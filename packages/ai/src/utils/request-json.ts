/**
 * A request body, serialized as JSON.stringify(body) does, byte for byte, with the JSON of the long strings in it taken from
 * a cache rather than escaped again on every request.
 *
 * Problem: every request sends the whole conversation, and the SDK runs JSON.stringify over all of it each time. Late in a
 * long session that is megabytes of tool results and file contents, escaped character by character, for text that has
 * not changed since it was first sent (29% of the CPU time of a 4.2M-token session).
 *
 * Solution: a provider marks the strings of a request that come from a finished message (markCachedString), with an object
 * of that message as the key. stringifyRequestBody() then writes those strings from a cache under the key: the JSON of
 * the value it last had. The cache costs about as much memory as the long strings of the conversation being sent. It is used only when the string is still that value (compared with ===), so a string that an
 * onPayload hook or the provider itself changed is escaped anew, and the output is always what JSON.stringify(body) gives.
 * Objects are written as JSON.stringify writes them: own enumerable keys in order, undefined, functions and symbols left
 * out (null in arrays). An object with a toJSON method, or anything that makes the serialization throw, gives `undefined`,
 * and the caller lets the SDK serialize the body as before.
 */

/** Strings shorter than this are not worth a cache entry. */
const MIN_CACHED_LENGTH = 1024;

/**
 * The cache: what each key's string was and its JSON, and the request that last used it. An entry that no request has
 * used for KEPT_REQUESTS requests is dropped (evictUnused): its message has left the conversation (compacted away, or on
 * another branch), and keeping the JSON of every string ever sent would hold memory for the life of the process. A few
 * requests rather than one, for sessions that send requests in turn in the same process.
 */
const jsonByKey = new Map<object, { value: string; json: string; usedBy: number }>();
const KEPT_REQUESTS = 16;
let requestCount = 0;

function evictUnused(): void {
	for (const [key, entry] of jsonByKey) {
		if (requestCount - entry.usedBy > KEPT_REQUESTS) jsonByKey.delete(key);
	}
}
/** For an object of a request: its fields whose string may come from the cache, and the key of each. */
const cachedFields = new WeakMap<object, Map<string, object>>();
/** Objects of a request that hold, at some depth, an object of `cachedFields`. */
const containers = new WeakSet<object>();

/**
 * Marks `holder[field]`, a string from a finished message, as one whose JSON may be cached under `key` (an object of that
 * message, the same from one request to the next). `parents` are the objects of the request that lead to `holder`, outermost
 * first.
 */
export function markCachedString(
	holder: object,
	field: string,
	value: string,
	key: object,
	...parents: object[]
): void {
	if (value.length < MIN_CACHED_LENGTH) return;
	let fields = cachedFields.get(holder);
	if (!fields) {
		fields = new Map();
		cachedFields.set(holder, fields);
	}
	fields.set(field, key);
	for (const parent of parents) containers.add(parent);
}

function cachedJson(key: object, value: string): string {
	const entry = jsonByKey.get(key);
	if (entry && entry.value === value) {
		entry.usedBy = requestCount;
		return entry.json;
	}
	const json = JSON.stringify(value);
	jsonByKey.set(key, { value, json, usedBy: requestCount });
	return json;
}

class NotSerializable extends Error {}

/** `body`: the request body itself, which is always written member by member. */
function serialize(
	value: unknown,
	fields: Map<string, object> | undefined,
	field: string,
	body = false,
): string | undefined {
	if (typeof value === "string") {
		const key = fields?.get(field);
		return key ? cachedJson(key, value) : JSON.stringify(value);
	}
	if (typeof value !== "object" || value === null) {
		return JSON.stringify(value);
	}
	// toJSON is called with the property's key, which a nested JSON.stringify() would not pass.
	if (typeof (value as { toJSON?: unknown }).toJSON === "function") throw new NotSerializable();
	const ownFields = cachedFields.get(value);
	if (!ownFields && !containers.has(value) && !body) {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		let json = "[";
		const length = value.length;
		for (let i = 0; i < length; i++) {
			if (i > 0) json += ",";
			json += serialize(value[i], undefined, "") ?? "null";
		}
		return `${json}]`;
	}
	if (Object.getPrototypeOf(value) !== Object.prototype) {
		return JSON.stringify(value);
	}
	let json = "{";
	let first = true;
	for (const key of Object.keys(value)) {
		const member = serialize((value as Record<string, unknown>)[key], ownFields, key);
		if (member === undefined) continue;
		json += `${first ? "" : ","}${JSON.stringify(key)}:${member}`;
		first = false;
	}
	return `${json}}`;
}

/** JSON.stringify(body), with the strings marked by markCachedString() from the cache; `undefined` if it cannot tell. */
export function stringifyRequestBody(body: object): string | undefined {
	requestCount++;
	try {
		return serialize(body, undefined, "", true);
	} catch {
		return undefined;
	} finally {
		evictUnused();
	}
}
