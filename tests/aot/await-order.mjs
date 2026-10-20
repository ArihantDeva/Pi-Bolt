// The order in which awaits resume: of settled and pending promises, plain values, thenables, subclassed promises and
// promises whose then or constructor was changed, interleaved with queueMicrotask, then() and process.nextTick, across
// many different async functions and generators (more than any cache of their entry points holds), with errors.

const log = [];
const say = (s) => log.push(s);

async function plain(name) {
	say(`${name} start`);
	await undefined;
	say(`${name} after undefined`);
	await 1;
	say(`${name} after 1`);
	await null;
	say(`${name} after null`);
	await Promise.resolve("x");
	say(`${name} after resolved`);
	await new Promise((resolve) => queueMicrotask(() => resolve("later")));
	say(`${name} after pending`);
	try {
		await Promise.reject(new Error("no"));
	} catch (e) {
		say(`${name} caught ${e.message}`);
	}
	return name;
}

async function thenables(name) {
	await { then: (resolve) => (say(`${name} then called`), resolve("t")) };
	say(`${name} after thenable`);
	await { then: undefined, value: 1 };
	say(`${name} after object without then`);
	const getter = {};
	Object.defineProperty(getter, "then", { get: () => (say(`${name} then getter`), undefined) });
	await getter;
	say(`${name} after then getter`);
	try {
		await { then: () => { throw new TypeError("then threw"); } };
	} catch (e) {
		say(`${name} caught ${e.message}`);
	}
	try {
		const bad = {};
		Object.defineProperty(bad, "then", { get() { throw new RangeError("getter threw"); } });
		await bad;
	} catch (e) {
		say(`${name} caught ${e.message}`);
	}
	await function () {};
	say(`${name} after function`);
}

class MyPromise extends Promise {}
async function special(name) {
	await MyPromise.resolve(1);
	say(`${name} after subclass`);
	const p = Promise.resolve(2);
	p.then = function (a, b) {
		say(`${name} own then`);
		return Promise.prototype.then.call(this, a, b);
	};
	await p;
	say(`${name} after own then`);
	const q = Promise.resolve(3);
	q.constructor = function Other() {};
	await q;
	say(`${name} after other constructor`);
}

async function* gen(name, n) {
	for (let i = 0; i < n; i++) {
		say(`${name} yield ${i}`);
		yield i;
		await undefined;
	}
	return "done";
}

async function nested(depth) {
	if (!depth) {
		await 0;
		return 0;
	}
	const value = await nested(depth - 1);
	say(`nested ${depth}`);
	return value + 1;
}

// Many distinct async functions resumed in turn.
const many = [
	async function f0(n) { for (let k = 0; k < n; k++) { await k; say("f0 " + k); } return 0; },
	async function f1(n) { for (let k = 0; k < n; k++) { await k; say("f1 " + k); } return 1; },
	async function f2(n) { for (let k = 0; k < n; k++) { await k; say("f2 " + k); } return 2; },
	async function f3(n) { for (let k = 0; k < n; k++) { await k; say("f3 " + k); } return 3; },
	async function f4(n) { for (let k = 0; k < n; k++) { await k; say("f4 " + k); } return 4; },
	async function f5(n) { for (let k = 0; k < n; k++) { await k; say("f5 " + k); } return 5; },
	async function f6(n) { for (let k = 0; k < n; k++) { await k; say("f6 " + k); } return 6; },
	async function f7(n) { for (let k = 0; k < n; k++) { await k; say("f7 " + k); } return 7; },
	async function f8(n) { for (let k = 0; k < n; k++) { await k; say("f8 " + k); } return 8; },
	async function f9(n) { for (let k = 0; k < n; k++) { await k; say("f9 " + k); } return 9; },
	async function f10(n) { for (let k = 0; k < n; k++) { await k; say("f10 " + k); } return 10; },
	async function f11(n) { for (let k = 0; k < n; k++) { await k; say("f11 " + k); } return 11; },
	async function f12(n) { for (let k = 0; k < n; k++) { await k; say("f12 " + k); } return 12; },
	async function f13(n) { for (let k = 0; k < n; k++) { await k; say("f13 " + k); } return 13; },
	async function f14(n) { for (let k = 0; k < n; k++) { await k; say("f14 " + k); } return 14; },
	async function f15(n) { for (let k = 0; k < n; k++) { await k; say("f15 " + k); } return 15; },
	async function f16(n) { for (let k = 0; k < n; k++) { await k; say("f16 " + k); } return 16; },
	async function f17(n) { for (let k = 0; k < n; k++) { await k; say("f17 " + k); } return 17; },
	async function f18(n) { for (let k = 0; k < n; k++) { await k; say("f18 " + k); } return 18; },
	async function f19(n) { for (let k = 0; k < n; k++) { await k; say("f19 " + k); } return 19; },
	async function f20(n) { for (let k = 0; k < n; k++) { await k; say("f20 " + k); } return 20; },
	async function f21(n) { for (let k = 0; k < n; k++) { await k; say("f21 " + k); } return 21; },
	async function f22(n) { for (let k = 0; k < n; k++) { await k; say("f22 " + k); } return 22; },
	async function f23(n) { for (let k = 0; k < n; k++) { await k; say("f23 " + k); } return 23; },
	async function f24(n) { for (let k = 0; k < n; k++) { await k; say("f24 " + k); } return 24; },
	async function f25(n) { for (let k = 0; k < n; k++) { await k; say("f25 " + k); } return 25; },
	async function f26(n) { for (let k = 0; k < n; k++) { await k; say("f26 " + k); } return 26; },
	async function f27(n) { for (let k = 0; k < n; k++) { await k; say("f27 " + k); } return 27; },
	async function f28(n) { for (let k = 0; k < n; k++) { await k; say("f28 " + k); } return 28; },
	async function f29(n) { for (let k = 0; k < n; k++) { await k; say("f29 " + k); } return 29; },
	async function f30(n) { for (let k = 0; k < n; k++) { await k; say("f30 " + k); } return 30; },
	async function f31(n) { for (let k = 0; k < n; k++) { await k; say("f31 " + k); } return 31; },
	async function f32(n) { for (let k = 0; k < n; k++) { await k; say("f32 " + k); } return 32; },
	async function f33(n) { for (let k = 0; k < n; k++) { await k; say("f33 " + k); } return 33; },
	async function f34(n) { for (let k = 0; k < n; k++) { await k; say("f34 " + k); } return 34; },
	async function f35(n) { for (let k = 0; k < n; k++) { await k; say("f35 " + k); } return 35; },
	async function f36(n) { for (let k = 0; k < n; k++) { await k; say("f36 " + k); } return 36; },
	async function f37(n) { for (let k = 0; k < n; k++) { await k; say("f37 " + k); } return 37; },
	async function f38(n) { for (let k = 0; k < n; k++) { await k; say("f38 " + k); } return 38; },
	async function f39(n) { for (let k = 0; k < n; k++) { await k; say("f39 " + k); } return 39; },
	async function f40(n) { for (let k = 0; k < n; k++) { await k; say("f40 " + k); } return 40; },
	async function f41(n) { for (let k = 0; k < n; k++) { await k; say("f41 " + k); } return 41; },
	async function f42(n) { for (let k = 0; k < n; k++) { await k; say("f42 " + k); } return 42; },
	async function f43(n) { for (let k = 0; k < n; k++) { await k; say("f43 " + k); } return 43; },
	async function f44(n) { for (let k = 0; k < n; k++) { await k; say("f44 " + k); } return 44; },
	async function f45(n) { for (let k = 0; k < n; k++) { await k; say("f45 " + k); } return 45; },
	async function f46(n) { for (let k = 0; k < n; k++) { await k; say("f46 " + k); } return 46; },
	async function f47(n) { for (let k = 0; k < n; k++) { await k; say("f47 " + k); } return 47; },
];

async function main() {
	queueMicrotask(() => say("microtask 1"));
	process.nextTick(() => say("tick 1"));
	Promise.resolve().then(() => say("then 1"));
	const a = plain("a");
	const b = thenables("b");
	const c = special("c");
	Promise.resolve().then(() => say("then 2"));
	queueMicrotask(() => say("microtask 2"));
	process.nextTick(() => say("tick 2"));
	say(`results ${await Promise.all([a, b, c])}`);

	const consumed = [];
	for await (const v of gen("g", 3)) consumed.push(v);
	say(`for await ${consumed}`);
	const it = gen("h", 2);
	const steps = [it.next(), it.next(), it.next(), it.return("early")];
	say(`gen steps ${JSON.stringify(await Promise.all(steps))}`);

	say(`nested result ${await nested(5)}`);

	const results = await Promise.all(many.map((f, i) => f(1 + (i % 3))));
	say(`many ${results.join(",")}`);
	// Again, interleaved with ticks and then() between rounds.
	for (let round = 0; round < 3; round++) {
		process.nextTick(() => say(`round ${round} tick`));
		Promise.resolve().then(() => say(`round ${round} then`));
		await Promise.all(many.slice(round * 16, round * 16 + 16).map((f) => f(2)));
	}
	try {
		await (async () => {
			await null;
			throw new SyntaxError("thrown after await");
		})();
	} catch (e) {
		say(`caught ${e.name}: ${e.message}`);
	}
}

await main();
setTimeout(() => {
	say("timeout");
	console.log(log.join("\n"));
}, 0);
