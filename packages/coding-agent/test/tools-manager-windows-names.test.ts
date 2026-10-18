import type * as Fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type * as Os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getToolPath } from "../src/utils/tools-manager.ts";

// getToolPath as on Windows, on any host: fd is looked up in PATH as fd.exe (or fd.com) only, not by Debian's fdfind.
vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof Os>();
	return { ...actual, platform: () => "win32" };
});

// (Not Pi's own tools folder: only PATH is looked at.)
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof Fs>();
	return { ...actual, existsSync: vi.fn(() => false) };
});

const originalPath = process.env.PATH;
const temporary: string[] = [];

afterEach(() => {
	process.env.PATH = originalPath;
	for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function binWith(...files: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-tools-windows-"));
	temporary.push(dir);
	for (const file of files) writeFileSync(join(dir, file), "");
	return dir;
}

describe("getToolPath on Windows", () => {
	it("finds fd.exe in PATH", () => {
		const bin = binWith("fd.exe");
		process.env.PATH = bin;
		expect(getToolPath("fd")).toBe(join(bin, "fd.exe"));
	});

	it("does not look for fdfind", () => {
		process.env.PATH = binWith("fdfind.exe");
		expect(getToolPath("fd")).toBeNull();
	});
});
