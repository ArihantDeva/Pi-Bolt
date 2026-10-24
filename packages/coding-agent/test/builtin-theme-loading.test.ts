import type * as Fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getThemesDir } from "../src/config.ts";
import { getAvailableThemes, initTheme, setTheme } from "../src/modes/interactive/theme/theme.ts";

// Every theme file in the themes folder is a built-in theme, but starting Pi reads only the one it uses: the folder is
// listed once, and a theme file is read when that theme is first used. Listing the themes (/theme, /settings) reads the
// folder, not the files.

const { reads } = vi.hoisted(() => ({ reads: [] as string[] }));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof Fs>();
	return {
		...actual,
		readFileSync: ((file: Fs.PathOrFileDescriptor, ...rest: unknown[]) => {
			if (typeof file === "string") reads.push(file);
			return (actual.readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
		}) as typeof actual.readFileSync,
	};
});

function themeFilesRead(): string[] {
	return reads
		.filter((file) => dirname(file) === getThemesDir() && file.endsWith(".json"))
		.map((file) => basename(file));
}

describe("built-in theme loading", () => {
	let agentDir: string;

	beforeAll(() => {
		agentDir = mkdtempSync(join(tmpdir(), "pi-theme-loading-"));
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	});

	afterAll(() => {
		vi.unstubAllEnvs();
		rmSync(agentDir, { recursive: true, force: true });
	});

	afterEach(() => {
		reads.length = 0;
	});

	it("reads only the theme in use", () => {
		initTheme("dark");
		expect(themeFilesRead()).toEqual(["dark.json"]);
		reads.length = 0;
		expect(setTheme("tokyo-night").success).toBe(true);
		expect(themeFilesRead()).toEqual(["tokyo-night.json"]);
		reads.length = 0;
		// (Each file is read once.)
		expect(setTheme("dark").success).toBe(true);
		expect(themeFilesRead()).toEqual([]);
	});

	it("reads no theme file for the system theme", () => {
		initTheme("system");
		expect(themeFilesRead()).toEqual([]);
	});

	it("lists every built-in theme without reading their files", () => {
		expect(getAvailableThemes()).toEqual(expect.arrayContaining(["dark", "light", "nord", "tokyo-night-day"]));
		expect(themeFilesRead()).toEqual([]);
	});
});
