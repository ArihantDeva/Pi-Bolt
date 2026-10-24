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
		getActiveThemeName: () => string;
		isPairMemberInUse: (themeName: string) => boolean;
		previewRestorer: () => () => void;
		preview: (themeName: string) => void;
	};
	showSelector: (
		create: (done: () => void) => { component: Component; focus: Component; dispose?: () => void },
	) => void;
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
	function open(setting: string, active: string, pairMember?: string) {
		const restore = vi.fn();
		let dispose: (() => void) | undefined;
		// (As showSelector()'s done does: it runs the selector's dispose hook first.)
		const done = vi.fn(() => dispose?.());
		let selector: ThemeSelectorComponent | undefined;
		const context: ThemeSelectorContext = {
			themeController: {
				getActiveThemeName: () => active,
				// (As the controller answers: the pair's member for the terminal's appearance, when it loaded.)
				isPairMemberInUse: (themeName) => setting.includes("/") && themeName === active && themeName === pairMember,
				previewRestorer: () => restore,
				preview: vi.fn(),
			},
			showSelector: (create) => {
				const created = create(done);
				selector = created.component as ThemeSelectorComponent;
				dispose = created.dispose;
			},
			selectTheme: vi.fn<(themeName: string) => void>(),
		};
		interactiveModePrototype.showThemeSelector.call(context);
		// (What disposeActiveSelector() runs when another selector or an extension's dialog replaces this one.)
		const replace = () => dispose?.();
		return { list: selector!.getSelectList(), restore, selectTheme: context.selectTheme, replace };
	}

	test("gives back the theme in use when an extension's dialog replaces the list during a preview", () => {
		const { list, restore, selectTheme, replace } = open("dark", "dark");
		list.setSelectedIndex(1);
		replace();
		expect(restore).toHaveBeenCalledTimes(1);
		expect(selectTheme).not.toHaveBeenCalled();
	});

	test("keeps a chosen theme when the list is disposed after the choice", () => {
		const { list, restore, selectTheme, replace } = open("dark", "dark");
		list.onSelect?.({ value: "dracula", label: "dracula" });
		replace();
		expect(selectTheme).toHaveBeenCalledWith("dracula");
		expect(restore).not.toHaveBeenCalled();
	});

	test("restores once when the list is closed with Esc", () => {
		const { list, restore, replace } = open("dark", "dark");
		list.onCancel?.();
		replace();
		expect(restore).toHaveBeenCalledTimes(1);
	});

	test("selects the member of a light/dark pair in use, and Enter on it keeps the pair", () => {
		const { list, restore, selectTheme } = open("nord/dracula", "nord", "nord");
		expect(list.getSelectedItem()?.value).toBe("nord");
		list.onSelect?.(list.getSelectedItem()!);
		expect(selectTheme).not.toHaveBeenCalled();
		expect(restore).toHaveBeenCalledTimes(1);
	});

	test("saves another theme chosen from a pair", () => {
		const { list, selectTheme } = open("nord/dracula", "nord", "nord");
		list.onSelect?.({ value: "dracula", label: "dracula" });
		expect(selectTheme).toHaveBeenCalledWith("dracula");
	});

	test("saves the system theme chosen when the pair's member failed to load", () => {
		const { list, restore, selectTheme } = open("missing/dracula", "system", "missing");
		expect(list.getSelectedItem()?.value).toBe("system");
		list.onSelect?.(list.getSelectedItem()!);
		expect(restore).not.toHaveBeenCalled();
		expect(selectTheme).toHaveBeenCalledWith("system");
	});

	test("selects the theme in use when the setting failed to load", () => {
		const { list } = open("no-such-theme", "system");
		expect(list.getSelectedItem()?.value).toBe("system");
	});
});
