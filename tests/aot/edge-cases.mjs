// Constructors that throw: ES5-style ones, and ones that never say `this` (compiled only for call, and constructed by calling
// them: with `new`, Reflect.construct, and through a value that could be either), a spread call in a small function that is
// inlined into a loop, module variables declared twice with `var`, and regular expressions run from a lastIndex past the end of
// a 16-bit string.
const out = [];
const log = (...a) => out.push(a.map(String).join(" "));

function Point(x) {
	if (typeof x !== "number") throw new TypeError("not a number: " + x);
	this.x = x;
}
const plain = {};
Point.call(plain, 1);
let made = 0, caught = 0;
for (let i = 0; i < 5000; i++) {
	try {
		made += new Point(i % 7 ? i : "x" + i).x > 0 ? 1 : 0;
	} catch (error) {
		if (error instanceof TypeError) caught++;
	}
}
log("constructed:", made, "caught:", caught, plain.x);
function Deep(n) {
	if (n === 0) throw new RangeError("bottom");
	this.inner = new Deep(n - 1);
}
try { new Deep(20); } catch (error) { log("deep:", error.name, error.message); }
function Box(value) {
	if (value % 5 === 0) throw new RangeError("no box for " + value);
	return { value, twice: value * 2 };
}
let boxed = 0, refused = 0;
for (let i = 0; i < 5000; i++) {
	try {
		boxed += new Box(i).twice;
	} catch (error) {
		refused += error instanceof RangeError ? 1 : 0;
	}
}
log("boxes:", boxed, "refused:", refused, Box(3).value);
const makers = [Box, function Crate(n) { if (n & 1) throw new TypeError("odd " + n); return { n }; }];
let viaReflect = 0, viaUnknown = 0, failed = 0;
for (let i = 0; i < 4000; i++) {
	const Maker = makers[i & 1];
	try { viaReflect += Reflect.construct(Maker, [i]) ? 1 : 0; } catch { failed++; }
	try { viaUnknown += new Maker(i + 1) ? 1 : 0; } catch { failed++; }
}
log("constructed indirectly:", viaReflect, viaUnknown, "failed:", failed);

const collect = (...a) => a.length + ":" + a.join(",");
function forward(first, xs) { return collect(first, ...xs, "end"); }
let spread = "";
for (let i = 0; i < 3000; i++) {
	const r = forward(i, [i & 3, i & 5]);
	if (i % 1000 === 0) spread += r + " ";
}
log("spread:", spread.trim());

var greet = function () { return "first"; };
var greet = function () { return "second"; };
var count = function () { return 1; };
if (globalThis.process) { var count = function () { return 2; }; }
let calls = "";
for (let i = 0; i < 2000; i++) {
	if (i % 500 === 0) calls += greet() + count();
}
log("module variables:", calls);

const wide = "αβγ ".repeat(8) + "Ωmega";
const patterns = [/Ω/g, /[α-γ]+/g, /m/y];
for (const p of patterns) {
	const found = [];
	for (const start of [0, 3, wide.length, wide.length + 1, wide.length + 100]) {
		p.lastIndex = start;
		const m = p.exec(wide);
		found.push(start + ">" + (m ? m.index : "none") + "/" + p.lastIndex);
	}
	log(p.source, found.join(" "));
}
console.log(out.join("\n"));
