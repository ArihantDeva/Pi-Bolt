import type { Component, Focusable, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { formatKeyText } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { UsageBar, UsageLine, UsageOverview } from "./overview.ts";

const BAR_WIDTH = 24;

const TONE_COLOR = {
	accent: "accent",
	warning: "warning",
	error: "error",
	success: "success",
} as const;

function renderBar(theme: Theme, bar: UsageBar): string {
	const frac = bar.total && bar.total > 0 ? Math.min(1, Math.max(0, bar.used / bar.total)) : 0;
	const filled = Math.round(frac * BAR_WIDTH);
	const fill = theme.fg(TONE_COLOR[bar.tone], "█".repeat(filled));
	const empty = theme.fg("muted", "░".repeat(BAR_WIDTH - filled));
	return `${fill}${empty}`;
}

/**
 * A read-only view showing account/session usage with tqdm-style progress
 * bars. Esc (or a click) closes it.
 */
export class UsagePopupComponent implements Component, Focusable {
	focused = false;

	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly overview: UsageOverview;
	private readonly onClose: () => void;

	constructor(theme: Theme, keybindings: KeybindingsManager, overview: UsageOverview, onClose: () => void) {
		this.theme = theme;
		this.keybindings = keybindings;
		this.overview = overview;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel") || this.keybindings.matches(data, "app.clear")) {
			this.onClose();
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
		if (event.type === "click") this.onClose();
		return { handled: true, render: false };
	}

	invalidate(): void {}

	render(_width: number): string[] {
		const theme = this.theme;
		const { providerId, modelId, bars, lines, notes } = this.overview;
		const out: string[] = [];
		const pad = "  ";

		const row = (label: string, value: string, tone?: UsageLine["tone"]): string => {
			const padded = label.padEnd(13);
			const coloredValue = tone ? theme.fg(TONE_COLOR[tone], value) : value;
			return `${pad}${theme.fg("dim", padded)} ${coloredValue}`;
		};

		out.push(theme.bold("Usage"));
		out.push(theme.fg("dim", `${providerId} · ${modelId}`));
		out.push("");

		if (bars.length > 0) {
			for (const bar of bars) {
				out.push(theme.fg("dim", bar.label));
				out.push(`${pad}${renderBar(theme, bar)}  ${theme.fg("dim", bar.display)}`);
				if (bar.note) out.push(`${pad}${theme.fg("dim", bar.note)}`);
			}
			out.push("");
		}

		out.push(theme.bold("This session"));
		for (const line of lines) {
			out.push(row(line.label, line.value, line.tone));
		}

		if (notes.length > 0) {
			out.push("");
			for (const note of notes) {
				out.push(theme.fg("warning", note));
			}
		}

		const closeKey = formatKeyText(this.keybindings.getKeys("tui.select.cancel")[0] ?? "escape");
		out.push("");
		out.push(theme.fg("muted", `${closeKey} to close`));

		return out;
	}
}
