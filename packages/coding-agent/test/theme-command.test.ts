import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

function fakeMode() {
	return {
		showThemeSelector: vi.fn(),
		selectTheme: vi.fn(),
		showError: vi.fn(),
	};
}

describe("InteractiveMode.handleThemeCommand", () => {
	test("opens the selector without an argument", () => {
		const mode = fakeMode();
		(InteractiveMode as any).prototype.handleThemeCommand.call(mode, undefined);
		expect(mode.showThemeSelector).toHaveBeenCalledTimes(1);
		expect(mode.selectTheme).not.toHaveBeenCalled();
	});

	test("switches directly to a known theme", () => {
		const mode = fakeMode();
		(InteractiveMode as any).prototype.handleThemeCommand.call(mode, "dracula");
		expect(mode.selectTheme).toHaveBeenCalledWith("dracula");
	});

	test("reports an unknown theme with the available names", () => {
		const mode = fakeMode();
		(InteractiveMode as any).prototype.handleThemeCommand.call(mode, "nope");
		expect(mode.selectTheme).not.toHaveBeenCalled();
		expect(mode.showError).toHaveBeenCalledWith(expect.stringContaining('Unknown theme "nope"'));
		expect(mode.showError).toHaveBeenCalledWith(expect.stringContaining("tokyo-night"));
	});
});
