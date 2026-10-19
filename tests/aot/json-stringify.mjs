// JSON.stringify where the fast serializer hands parts back and forth with the general one: toJSON (own, hidden, inherited,
// on arrays), what it may change while it runs, getters, raw JSON, indentation at every depth, wide strings, errors.

function sum(text) {
	let h = 0;
	for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
	return h;
}
function show(name, f) {
	let out;
	try {
		const text = f();
		out = text === undefined ? "undefined" : text.length > 300 ? `${text.length} ${sum(text)} ${text.slice(0, 120)}...${text.slice(-60)}` : text;
	} catch (e) {
		out = `threw ${e?.constructor?.name}: ${e?.message}`;
	}
	console.log(`${name}: ${out}`);
}
const log = [];
const hidden = (target, toJSON) => Object.defineProperty(target, "toJSON", { value: toJSON, enumerable: false, configurable: true, writable: true });
const big = (n, tag) => Array.from({ length: n }, (_, i) => ({ id: i, tag, text: `line ${i} "quoted" \\ back\nslash`, ok: i % 2 === 0, n: i * 1.5 }));

// A hidden toJSON on an array, the way Pi marks a request's messages.
for (const gap of [undefined, 2, "\t", "--"]) {
	const messages = big(300, "m");
	hidden(messages, function (key) {
		log.push(`messages.toJSON(${JSON.stringify(key)})`);
		return this.map((m) => ({ ...m, text: m.id % 3 ? m.text : JSON.rawJSON(JSON.stringify(m.text)) }));
	});
	show(`array toJSON gap=${JSON.stringify(gap)}`, () => JSON.stringify({ model: "m", messages, stream: true, tools: [{ a: 1 }, { b: [1, 2, { c: null }] }] }, null, gap));
}
// A hidden toJSON on an object, defined after its properties: found only at the end of them.
for (const gap of [undefined, 3]) {
	const body = { model: "m", list: big(200, "b"), nested: { deep: { deeper: [1, 2, 3] } } };
	hidden(body, function (key) {
		log.push(`body.toJSON(${JSON.stringify(key)})`);
		const { list, ...rest } = this;
		return { ...rest, count: list.length, list: list.slice(0, 50) };
	});
	show(`object toJSON gap=${gap}`, () => JSON.stringify({ outer: [body, body] }, null, gap));
}
// Enumerable and inherited toJSON, toJSON returning something that has a toJSON (not called again), toJSON on a primitive's box.
class Point {
	constructor(x, y) {
		this.x = x;
		this.y = y;
	}
	toJSON(key) {
		log.push(`Point(${this.x}).toJSON(${JSON.stringify(key)})`);
		return { p: [this.x, this.y], again: { toJSON: () => "never" } };
	}
}
show("inherited toJSON", () => JSON.stringify({ a: [new Point(1, 2), { q: new Point(3, 4) }], b: { toJSON: (k) => `own ${k}` } }));
show("toJSON returns toJSON", () => JSON.stringify([{ toJSON: () => ({ toJSON: () => "inner" }) }]));
show("dates", () => JSON.stringify({ when: new Date(0), list: [new Date(86400000), { d: new Date(1e12) }] }, null, 1));
show("many dates", () => JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ i, at: new Date(i * 1000), rest: { x: i, y: [i, i + 1] } }))));
show("boxed", () => JSON.stringify({ s: new String("str"), n: new Number(4), b: new Boolean(false), list: [Object("x")] }));

// What a toJSON changes while it runs is seen as the spec says: keys are taken when an object starts, values when they are reached.
{
	const parent = { first: null, second: "two", third: [1, 2], fourth: { k: "v" } };
	parent.first = {
		toJSON() {
			log.push("first.toJSON");
			parent.second = "changed";
			delete parent.third;
			parent.fourth.k = "changed too";
			parent.added = "not seen";
			return "first";
		},
	};
	show("toJSON changes its parent", () => JSON.stringify({ parent }));
}
{
	const list = [1, { toJSON: () => (list.push("pushed"), list.length = 5, list[3] = { x: "set" }, "t") }, 2, 3, { y: 4 }, 6];
	show("toJSON changes its array", () => JSON.stringify({ list }));
}
{
	const target = { a: 1 };
	const holder = { before: { x: 1 }, t: { toJSON: () => (Object.defineProperty(target, "toJSON", { value: () => "late", enumerable: false }), "t") }, target };
	show("toJSON adds a toJSON", () => JSON.stringify(holder));
	// (Not Object.prototype: the AOT build makes the built-in prototypes immutable.)
	class Shape {
		constructor(n) {
			this.n = n;
		}
	}
	show("toJSON added to a prototype", () => {
		const o = { a: { b: { toJSON: () => ((Shape.prototype.toJSON = function () { return `shape ${this.n}`; }), "first") }, c: new Shape(1), d: [new Shape(2), { e: new Shape(3) }] } };
		return JSON.stringify(o);
	});
}
// Getters: called in order, between toJSON calls.
{
	const o = { a: { toJSON: () => (log.push("a.toJSON"), "A") } };
	Object.defineProperty(o, "g", { enumerable: true, get: () => (log.push("g get"), { inner: [1, { toJSON: () => (log.push("inner.toJSON"), "I") }] }) });
	o.z = { plain: true };
	show("getters", () => JSON.stringify([o, o], null, 2));
}
// Errors from toJSON and getters, and cycles through a toJSON, stop it as before.
show("toJSON throws", () => JSON.stringify({ ok: big(20, "x"), bad: { toJSON() { throw new RangeError("from toJSON"); } } }));
show("getter throws", () => JSON.stringify([{ a: 1 }, Object.defineProperty({}, "g", { enumerable: true, get() { throw new TypeError("from getter"); } })]));
{
	const a = { name: "a" };
	a.self = { via: { toJSON: () => ({ back: a }) } };
	show("cycle through toJSON", () => JSON.stringify({ list: [a] }));
	const b = [{ x: 1 }];
	b.push({ toJSON: () => [b] });
	show("array cycle", () => JSON.stringify(b));
}
show("bigint inside", () => JSON.stringify({ a: { toJSON: () => "x" }, b: { c: [1, 2n] } }));
show("undefined, symbols, functions", () => JSON.stringify({ t: { toJSON: () => 1 }, list: [undefined, Symbol("s"), () => 1, { u: undefined, s: Symbol("t"), f() {} }], u: undefined }, null, 2));

// Raw JSON values, narrow and wide, at the top and inside.
show("raw top", () => JSON.stringify(JSON.rawJSON("123")));
show("raw in object", () => JSON.stringify({ a: JSON.rawJSON('"x\\ny"'), b: [JSON.rawJSON("null"), JSON.rawJSON("1e3")] }, null, 2));
show("raw wide", () => JSON.stringify({ a: JSON.rawJSON('"→ arrow"'), b: "plain", c: [JSON.rawJSON('"café"')] }));
show("raw wide in toJSON", () => JSON.stringify({ m: hidden([1, 2], () => [JSON.rawJSON('"中文"'), JSON.rawJSON('"latin é"'), "x"]) }));

// Wide strings in parts that are serialized fast inside parts that are not, and in big outputs.
{
	const wide = big(300, "w");
	wide[150].text += " → 😀 lone \ud800 end";
	show("wide inside", () => JSON.stringify({ a: { toJSON: () => "x" }, wide, after: "été" }, null, 1));
	show("wide early", () => JSON.stringify([{ toJSON: () => "☃" }, "☃".repeat(10), big(100, "e")]));
	show("latin1 in wide string", () => JSON.stringify({ t: { toJSON: () => 1 }, s: "café →".slice(0, 4) }));
}
// Escaping of 16-bit strings: every kind of character at every place in blocks of sixteen, lone and paired surrogates at the
// ends of blocks, Latin-1-only blocks inside wide strings.
{
	const kinds = ["a", " ", '"', "\\", "\n", "\t", "\u0001", "\u001f", "\u007f", "\u00e9", "\u00ff", "\u0100", "\u2192", "\ud83d\ude00", "\ud800", "\udfff", "\u4e2d"];
	let seed = 7;
	const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8;
	const strings = [];
	for (let n = 0; n < 400; n++) {
		let s = n % 3 ? "\u2192" : "";
		const length = next() % 70;
		for (let i = 0; i < length; i++) s += next() % 4 ? String.fromCharCode(97 + (next() % 26)) : kinds[next() % kinds.length];
		strings.push(s);
	}
	show("wide escapes", () => JSON.stringify(strings));
	show("wide escapes, in toJSON", () => JSON.stringify({ t: { toJSON: () => strings.slice(0, 200) }, rest: strings.slice(200) }, null, 1));
	for (const at of [15, 16, 17, 31, 32]) {
		const pad = "x".repeat(at);
		show(`surrogate at ${at}`, () => JSON.stringify([`${pad}\ud83d\ude00${pad}`, `${pad}\ud83d`, `${pad}\ude00\u2192`, `\u2192${pad}"\n${pad}\u00e9`]));
	}
}
// Depth: indentation of a fast part deep inside slow ones, and a very deep chain with a toJSON at the bottom.
{
	let v = { leaf: { toJSON: () => ({ end: [1, { two: 2 }] }) } };
	for (let i = 0; i < 6; i++) v = { level: i, v, sibling: [i, { s: i }] };
	show("deep indent", () => JSON.stringify(v, null, 2));
	show("deep indent string gap", () => JSON.stringify(v, null, "ab"));
	let chain = { bottom: { toJSON: () => "bottom" } };
	for (let i = 0; i < 3000; i++) chain = { i, next: chain };
	show("long chain", () => JSON.stringify(chain));
	let arrays = [{ toJSON: () => "x" }];
	for (let i = 0; i < 3000; i++) arrays = [i, arrays];
	show("long array chain", () => JSON.stringify(arrays));
}
// A replacer function or list still goes through the general serializer only.
show("replacer function", () => JSON.stringify({ a: { b: 1, c: [1, 2] }, d: { toJSON: () => ({ e: 2 }) } }, (k, v) => (log.push(`r ${k}`), typeof v === "number" ? v * 10 : v)));
show("replacer list", () => JSON.stringify({ a: { a: 1, b: 2 }, b: { toJSON: () => ({ a: 3, c: 4 }) } }, ["a", "b"], 1));
show("proxy", () => JSON.stringify({ t: { toJSON: () => 0 }, p: new Proxy({ x: 1, y: [2] }, {}), pa: new Proxy([1, { z: 2 }], {}) }));
show("indexed keys", () => JSON.stringify({ t: { toJSON: () => 0 }, o: { 1: "one", b: "bee", 0: "zero" } }));
console.log(log.join("\n"));
