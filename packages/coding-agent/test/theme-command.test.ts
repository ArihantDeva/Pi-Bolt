import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import type { ThemeSelectorComponent } from "../src/modes/interactive/components/theme-selector.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type ThemeCommandContext = {
	showThemeSelector: () => void;
	selectTheme: (themeName: string) => void;
	showError: (message: string) => void;
};

type ThemeSelectorContext = {
	themeController: {
		getThemeSelection: () => string | undefined;
		getActiveThemeName: () => string | undefined;
		previewRestorer: () => () => void;
		preview: (themeName: string) => void;
	};
	showSelector: (create: (done: () => void) => { component: Component; focus: Component }) => void;
	selectTheme: (themeName: string) => void;
};

type InteractiveModePrototype = {
	handleThemeCommand(this: ThemeCommandContext, themeName?: string): void;
	showThemeSelector(this: ThemeSelectorContext): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

function fakeMode() {
	return {
		showThemeSelector: vi.fn<() => void>(),
		selectTheme: vi.fn<(themeName: string) => void>(),
		showError: vi.fn<(message: string) => void>(),
	};
}

describe("InteractiveMode.handleThemeCommand", () => {
	test("opens the selector without an argument", () => {
		const mode = fakeMode();
		interactiveModePrototype.handleThemeCommand.call(mode, undefined);
		expect(mode.showThemeSelector).toHaveBeenCalledTimes(1);
		expect(mode.selectTheme).not.toHaveBeenCalled();
	});

	test("switches directly to a known theme", () => {
		const mode = fakeMode();
		interactiveModePrototype.handleThemeCommand.call(mode, "dracula");
		expect(mode.selectTheme).toHaveBeenCalledWith("dracula");
	});

	test("reports an unknown theme with the available names", () => {
		const mode = fakeMode();
		interactiveModePrototype.handleThemeCommand.call(mode, "nope");
		expect(mode.selectTheme).not.toHaveBeenCalled();
		expect(mode.showError).toHaveBeenCalledWith(expect.stringContaining('Unknown theme "nope"'));
		expect(mode.showError).toHaveBeenCalledWith(expect.stringContaining("tokyo-night"));
	});
});

describe("InteractiveMode.showThemeSelector", () => {
	function open(setting: string, active: string | undefined) {
		const restore = vi.fn();
		const done = vi.fn();
		let selector: ThemeSelectorComponent | undefined;
		const context: ThemeSelectorContext = {
			themeController: {
				getThemeSelection: () => setting,
				getActiveThemeName: () => active,
				previewRestorer: () => restore,
				preview: vi.fn(),
			},
			showSelector: (create) => {
				selector = create(done).component as ThemeSelectorComponent;
			},
			selectTheme: vi.fn<(themeName: string) => void>(),
		};
		interactiveModePrototype.showThemeSelector.call(context);
		return { list: selector!.getSelectList(), restore, selectTheme: context.selectTheme };
	}

	test("selects the member of a light/dark pair in use, and Enter on it keeps the pair", () => {
		const { list, restore, selectTheme } = open("nord/dracula", "nord");
		expect(list.getSelectedItem()?.value).toBe("nord");
		list.onSelect?.(list.getSelectedItem()!);
		expect(selectTheme).not.toHaveBeenCalled();
		expect(restore).toHaveBeenCalledTimes(1);
	});

	test("saves another theme chosen from a pair", () => {
		const { list, selectTheme } = open("nord/dracula", "nord");
		list.onSelect?.({ value: "dracula", label: "dracula" });
		expect(selectTheme).toHaveBeenCalledWith("dracula");
	});

	test("selects the theme in use when the setting failed to load", () => {
		const { list } = open("no-such-theme", "system");
		expect(list.getSelectedItem()?.value).toBe("system");
	});
});
