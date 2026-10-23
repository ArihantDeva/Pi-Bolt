import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type ThemeCommandContext = {
	showThemeSelector: () => void;
	selectTheme: (themeName: string) => void;
	showError: (message: string) => void;
};

type InteractiveModePrototype = {
	handleThemeCommand(this: ThemeCommandContext, themeName?: string): void;
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
