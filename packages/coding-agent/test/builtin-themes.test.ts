import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAvailableThemes, getThemeByName } from "../src/modes/interactive/theme/theme.ts";
import { validateThemeJson } from "../src/modes/interactive/theme/theme-schema.ts";

const themesDir = new URL("../src/modes/interactive/theme/", import.meta.url);
const themeFiles = readdirSync(themesDir).filter((file) => file.endsWith(".json"));

describe("built-in themes", () => {
	it("ships the popular palettes next to dark and light", () => {
		const names = getAvailableThemes();
		expect(names).toEqual(
			expect.arrayContaining([
				"dark",
				"light",
				"tokyo-night",
				"catppuccin-mocha",
				"catppuccin-latte",
				"dracula",
				"nord",
				"gruvbox-dark",
				"solarized-dark",
				"one-dark",
				"rose-pine",
				"monokai",
			]),
		);
	});

	it.each(themeFiles)("%s is a valid theme named after its file", (file) => {
		const json = JSON.parse(readFileSync(new URL(file, themesDir), "utf-8"));
		const validated = validateThemeJson(file, json);
		expect(validated.name).toBe(file.slice(0, -".json".length));
	});

	it.each(themeFiles)("%s resolves every color", (file) => {
		expect(getThemeByName(file.slice(0, -".json".length))).toBeDefined();
	});
});

type ThemeFile = { vars: Record<string, string>; colors: Record<string, string> };

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** Text roles and the surfaces they are drawn on: tool panels, messages, selection, search matches, code. */
const READABLE_PAIRS: [string, string][] = [
	["text", "bg"],
	["muted", "bg"],
	["thinkingText", "bg"],
	["accent", "bg"],
	["error", "bg"],
	["success", "bg"],
	["warning", "bg"],
	["toolTitle", "toolPendingBg"],
	["toolOutput", "toolPendingBg"],
	["toolTitle", "toolSuccessBg"],
	["toolOutput", "toolSuccessBg"],
	["toolDiffAdded", "toolSuccessBg"],
	["toolTitle", "toolErrorBg"],
	["toolOutput", "toolErrorBg"],
	["toolDiffRemoved", "toolErrorBg"],
	["toolDiffAdded", "toolPendingBg"],
	["toolDiffRemoved", "toolPendingBg"],
	["userMessageText", "userMessageBg"],
	["customMessageText", "customMessageBg"],
	["customMessageLabel", "customMessageBg"],
	["text", "selectedBg"],
	["accent", "selectedBg"],
	["searchMatchText", "searchMatchBg"],
	["mdHeading", "bg"],
	["mdLink", "bg"],
	["mdCode", "bg"],
	// Code is drawn on the page, in tool output and in user and custom messages (a code block in a summary or a skill).
	...["mdCodeBlock", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxString", "syntaxNumber", "syntaxType"]
		.concat(["syntaxVariable", "syntaxOperator", "syntaxPunctuation"])
		.flatMap((fg) =>
			["bg", "toolPendingBg", "toolSuccessBg", "toolErrorBg", "userMessageBg", "customMessageBg"].map(
				(bg): [string, string] => [fg, bg],
			),
		),
];

describe("built-in palette themes", () => {
	const paletteFiles = themeFiles.filter((file) => {
		const json = JSON.parse(readFileSync(new URL(file, themesDir), "utf-8")) as ThemeFile;
		return json.vars.bg?.startsWith("#");
	});

	it.each(paletteFiles)("%s keeps text readable on every surface it is drawn on", (file) => {
		const json = JSON.parse(readFileSync(new URL(file, themesDir), "utf-8")) as ThemeFile;
		const resolve = (token: string) =>
			token === "bg" ? json.vars.bg : (json.vars[json.colors[token]] ?? json.colors[token]);
		const failures = READABLE_PAIRS.filter(([fg, bg]) => contrast(resolve(fg), resolve(bg)) < 4).map(
			([fg, bg]) => `${fg} on ${bg}`,
		);
		expect(failures).toEqual([]);
	});
});
