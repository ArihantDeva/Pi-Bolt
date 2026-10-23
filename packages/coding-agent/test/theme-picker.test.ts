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
	setTheme,
	stopThemeWatcher,
	theme,
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
		stopThemeWatcher();
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

	it("keeps the built-in theme when an invalid custom file of its name declares another name", () => {
		const builtinPath = fileURLToPath(new URL("../src/modes/interactive/theme/nord.json", import.meta.url));
		const customPath = join(process.env.PI_CODING_AGENT_DIR!, "themes", "nord.json");
		writeFileSync(customPath, JSON.stringify({ name: "my-nord" }));
		expect(getAvailableThemesWithPaths().filter((theme) => theme.name === "nord")).toEqual([
			{ name: "nord", path: builtinPath },
		]);
		expect(setTheme("nord").success).toBe(true);
		expect(theme.fg("accent", "x")).toBe(loadThemeFromPath(builtinPath).fg("accent", "x"));
	});

	it("brings the built-in theme back when the watched custom file is edited to declare another name", async () => {
		const builtinPath = fileURLToPath(new URL("../src/modes/interactive/theme/nord.json", import.meta.url));
		const builtin = JSON.parse(readFileSync(builtinPath, "utf-8")) as ThemeFile;
		const customPath = join(process.env.PI_CODING_AGENT_DIR!, "themes", "nord.json");
		const write = (name: string, accent: string) =>
			writeFileSync(customPath, JSON.stringify({ ...builtin, name, colors: { ...builtin.colors, accent } }));
		write("nord", "#123456");
		// (As the resource loader registers it.)
		setRegisteredThemes([loadThemeFromPath(customPath)]);
		expect(setTheme("nord", true).success).toBe(true);
		expect(theme.fg("accent", "x")).toBe(loadThemeFromPath(customPath).fg("accent", "x"));
		const builtinAccent = loadThemeFromPath(builtinPath).fg("accent", "x");
		write("my-nord", "#654321");
		await vi.waitFor(() => expect(theme.fg("accent", "x")).toBe(builtinAccent), { timeout: 3000 });
		expect(getThemeByName("nord")?.fg("accent", "x")).toBe(builtinAccent);
		write("nord", "#abcdef");
		await vi.waitFor(() => expect(theme.fg("accent", "x")).toBe(loadThemeFromPath(customPath).fg("accent", "x")), {
			timeout: 3000,
		});
	});

	it("does not watch a custom file of a built-in's name that declares another name", async () => {
		const builtinPath = fileURLToPath(new URL("../src/modes/interactive/theme/nord.json", import.meta.url));
		const builtin = JSON.parse(readFileSync(builtinPath, "utf-8")) as ThemeFile;
		const customPath = join(process.env.PI_CODING_AGENT_DIR!, "themes", "nord.json");
		const write = (accent: string) =>
			writeFileSync(
				customPath,
				JSON.stringify({ ...builtin, name: "my-nord", colors: { ...builtin.colors, accent } }),
			);
		write("#123456");
		expect(setTheme("nord", true).success).toBe(true);
		const builtinAccent = loadThemeFromPath(builtinPath).fg("accent", "x");
		expect(theme.fg("accent", "x")).toBe(builtinAccent);
		write("#654321");
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(theme.fg("accent", "x")).toBe(builtinAccent);
	});

	it("watches a custom theme that replaces a built-in", async () => {
		const builtinPath = fileURLToPath(new URL("../src/modes/interactive/theme/dark.json", import.meta.url));
		const builtin = JSON.parse(readFileSync(builtinPath, "utf-8")) as ThemeFile;
		const customPath = join(process.env.PI_CODING_AGENT_DIR!, "themes", "dark.json");
		const write = (accent: string) =>
			writeFileSync(customPath, JSON.stringify({ ...builtin, colors: { ...builtin.colors, accent } }));
		write("#123456");
		expect(setTheme("dark", true).success).toBe(true);
		expect(theme.fg("accent", "x")).toBe(loadThemeFromPath(customPath).fg("accent", "x"));
		write("#654321");
		await vi.waitFor(() => expect(theme.fg("accent", "x")).toBe(loadThemeFromPath(customPath).fg("accent", "x")), {
			timeout: 3000,
		});
	});
});
