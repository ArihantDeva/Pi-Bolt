import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAvailableThemes,
	getAvailableThemesWithPaths,
	getThemeByName,
	loadThemeFromPath,
	setRegisteredThemes,
} from "../src/modes/interactive/theme/theme.ts";

type ThemeFile = {
	name: string;
	vars?: Record<string, string | number>;
	colors: Record<string, string | number>;
};

describe("theme picker", () => {
	let tempRoot: string;

	beforeEach(() => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-theme-picker-"));
		const agentDir = join(tempRoot, "agent");
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		mkdirSync(join(agentDir, "themes"), { recursive: true });
		setRegisteredThemes([]);
	});

	afterEach(() => {
		setRegisteredThemes([]);
		rmSync(tempRoot, { recursive: true, force: true });
		vi.unstubAllEnvs();
	});

	it("uses custom theme content names instead of file names", () => {
		const darkTheme = JSON.parse(
			readFileSync(new URL("../src/modes/interactive/theme/dark.json", import.meta.url), "utf-8"),
		) as ThemeFile;
		const customTheme: ThemeFile = {
			...darkTheme,
			name: "bar",
		};

		const themePath = join(process.env.PI_CODING_AGENT_DIR!, "themes", "foo.json");
		writeFileSync(themePath, JSON.stringify(customTheme, null, 2));

		expect(getAvailableThemes()).toContain("bar");
		expect(getAvailableThemes()).not.toContain("foo");
		expect(getAvailableThemesWithPaths()).toContainEqual({ name: "bar", path: themePath });
		expect(getAvailableThemesWithPaths().some((theme) => theme.name === "foo")).toBe(false);
	});

	it("lets a custom theme replace a built-in theme of the same name", () => {
		const builtinPath = fileURLToPath(new URL("../src/modes/interactive/theme/nord.json", import.meta.url));
		const builtin = JSON.parse(readFileSync(builtinPath, "utf-8")) as ThemeFile;
		const customTheme: ThemeFile = { ...builtin, colors: { ...builtin.colors, accent: "#123456" } };
		const customPath = join(process.env.PI_CODING_AGENT_DIR!, "themes", "nord.json");
		writeFileSync(customPath, JSON.stringify(customTheme, null, 2));

		const listed = getAvailableThemesWithPaths().filter((theme) => theme.name === "nord");
		expect(listed).toEqual([{ name: "nord", path: customPath }]);

		const accent = (theme: { fg(color: "accent", text: string): string } | undefined) => theme?.fg("accent", "x");
		expect(accent(getThemeByName("nord"))).toBe(accent(loadThemeFromPath(customPath)));
		expect(accent(getThemeByName("nord"))).not.toBe(accent(loadThemeFromPath(builtinPath)));
	});

	it("keeps the built-in theme when a custom file of its name declares another name", () => {
		const builtinPath = fileURLToPath(new URL("../src/modes/interactive/theme/nord.json", import.meta.url));
		const builtin = JSON.parse(readFileSync(builtinPath, "utf-8")) as ThemeFile;
		const customTheme: ThemeFile = { ...builtin, name: "my-nord", colors: { ...builtin.colors, accent: "#123456" } };
		const customPath = join(process.env.PI_CODING_AGENT_DIR!, "themes", "nord.json");
		writeFileSync(customPath, JSON.stringify(customTheme, null, 2));

		expect(getAvailableThemesWithPaths()).toEqual(
			expect.arrayContaining([
				{ name: "my-nord", path: customPath },
				{ name: "nord", path: builtinPath },
			]),
		);
		const accent = (theme: { fg(color: "accent", text: string): string } | undefined) => theme?.fg("accent", "x");
		expect(accent(getThemeByName("nord"))).toBe(accent(loadThemeFromPath(builtinPath)));
	});
});
