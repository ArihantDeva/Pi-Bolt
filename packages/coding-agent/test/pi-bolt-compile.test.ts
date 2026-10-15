import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	type CompiledExtension,
	compiledExtensionFor,
	extensionFingerprint,
	setCompiledExtensions,
} from "../src/core/extensions/compiled.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { checkReleaseSums } from "../src/pi-bolt-compile.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pibolt-compiled-"));
});

afterEach(() => {
	setCompiledExtensions([]);
	rmSync(dir, { recursive: true, force: true });
});

const factory: ExtensionFactory = () => {};

function compiledIn(source: Omit<CompiledExtension, "fingerprint" | "factory" | "name">): CompiledExtension {
	const fingerprint = extensionFingerprint(source);
	if (!fingerprint) throw new Error(`no fingerprint for ${source.entry}`);
	return { name: "test", factory, fingerprint, ...source };
}

/** Sets a file's modification time `seconds` after the epoch, so that a change is seen whatever the file system's clock. */
function touch(path: string, seconds: number): void {
	utimesSync(path, seconds, seconds);
}

describe("an extension compiled in stands in for its installed copy", () => {
	test("while the file is unchanged, its compiled factory is used", () => {
		const entry = join(dir, "word-count.ts");
		writeFileSync(entry, "export default () => {};\n");
		setCompiledExtensions([compiledIn({ entry, scope: "file", root: dir })]);
		expect(compiledExtensionFor(entry)).toEqual({ factory });
	});

	test("a changed file is loaded from its files again", () => {
		const entry = join(dir, "word-count.ts");
		writeFileSync(entry, "export default () => {};\n");
		touch(entry, 1_000_000);
		const extension = compiledIn({ entry, scope: "file", root: dir });
		setCompiledExtensions([extension]);
		touch(entry, 2_000_000);
		expect(compiledExtensionFor(entry)).toEqual({ changed: extension });
	});

	test("a folder extension changes with any of its own files, and not with its node_modules", () => {
		const root = join(dir, "folder-ext");
		mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
		const entry = join(root, "index.ts");
		writeFileSync(entry, 'import { greeting } from "./helper.ts";\n');
		writeFileSync(join(root, "helper.ts"), "export const greeting = 1;\n");
		writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
		for (const file of [entry, join(root, "helper.ts")]) touch(file, 1_000_000);
		const extension = compiledIn({ entry, scope: "folder", root });
		setCompiledExtensions([extension]);
		writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports = 2;\n");
		expect(compiledExtensionFor(entry)).toEqual({ factory });
		writeFileSync(join(root, "helper.ts"), "export const greeting = 2;\n");
		touch(join(root, "helper.ts"), 2_000_000);
		expect(compiledExtensionFor(entry)).toEqual({ changed: extension });
	});

	test("a package changes with its version", () => {
		const root = join(dir, "pi-lens");
		mkdirSync(root);
		const entry = join(root, "index.js");
		writeFileSync(entry, "export default () => {};\n");
		touch(entry, 1_000_000);
		writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
		const extension = compiledIn({ entry, scope: "package", root });
		setCompiledExtensions([extension]);
		expect(compiledExtensionFor(entry)).toEqual({ factory });
		writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.0.1" }));
		expect(compiledExtensionFor(entry)).toEqual({ changed: extension });
	});

	test("one removed since has no fingerprint, and an extension not compiled in is loaded as always", () => {
		const entry = join(dir, "gone.ts");
		writeFileSync(entry, "export default () => {};\n");
		const extension = compiledIn({ entry, scope: "file", root: dir });
		setCompiledExtensions([extension]);
		rmSync(entry);
		expect(extensionFingerprint(extension)).toBeUndefined();
		expect(compiledExtensionFor(join(dir, "other.ts"))).toBeUndefined();
	});

	test("with nothing compiled in, nothing is looked up", () => {
		expect(compiledExtensionFor(join(dir, "anything.ts"))).toBeUndefined();
	});
});

describe("pi-bolt compile takes a release's files only with its signature", () => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const key = publicKey.export({ type: "spki", format: "pem" }).toString();
	const kitSha = "a".repeat(64);
	const sums = Buffer.from(`# pi-bolt 0.9.0\n${kitSha}  pi-bolt-kit-linux-x64.tar.gz\n`);

	test("signed checksums of the version asked for give each file's SHA-256", () => {
		const sha = checkReleaseSums(sums, sign(null, sums, privateKey), "0.9.0", key);
		expect(sha.get("pi-bolt-kit-linux-x64.tar.gz")).toBe(kitSha);
	});

	test("a signature by another key is refused", () => {
		const other = generateKeyPairSync("ed25519").privateKey;
		expect(() => checkReleaseSums(sums, sign(null, sums, other), "0.9.0", key)).toThrow("does not verify");
	});

	test("checksums changed after signing are refused", () => {
		const signature = sign(null, sums, privateKey);
		const changed = Buffer.from(sums.toString().replace(kitSha, "b".repeat(64)));
		expect(() => checkReleaseSums(changed, signature, "0.9.0", key)).toThrow("does not verify");
	});

	test("another release's checksums, signed all the same, are refused", () => {
		expect(() => checkReleaseSums(sums, sign(null, sums, privateKey), "0.9.1", key)).toThrow("not Pi-Bolt 0.9.1's");
	});

	test("the release key is the default", () => {
		expect(() => checkReleaseSums(sums, sign(null, sums, privateKey), "0.9.0")).toThrow("does not verify");
	});
});
