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
