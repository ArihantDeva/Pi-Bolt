// Array#sort with a comparator, inlined into the function that calls it: the comparator's double arithmetic on an Int32
// array's elements must not make the sort store them back as doubles (oven-sh/WebKit#792). Few rounds, so that the
// reference never compiles it; the ahead-of-time build compiles every function.
function int32Pairs(a, b, c, d) {
	return [a, b, c, d].sort((x, y) => x + 0.5 - (y + 0.5));
}

function int32Many(n) {
	const values = [];
	for (let i = 0; i < n; i++) values.push((i * 7919) % 101);
	return values.sort((x, y) => x / 2 - y / 2);
}

function mixed(a, b, c) {
	return [a, b, c].sort((x, y) => x * 1.5 - y * 1.5);
}

function strings(list) {
	return [...list].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

const seen = new Set();
for (let round = 0; round < 50; round++) {
	const r = int32Pairs(17, 8, 1, 1);
	seen.add(`${r.join()} ${r.indexOf(8)} ${r.every(Number.isInteger)}`);
	seen.add(int32Many(40).join());
	seen.add(mixed(2.5, -1, 3).join());
	seen.add(strings(["pear", "apple", "fig", "apple"]).join());
}
for (const line of seen) console.log(line);
