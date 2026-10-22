import {
	type Component,
	type Focusable,
	getKeybindings,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import type { UsageBar, UsageLine, UsageOverview } from "../../../core/usage-overview.ts";
import { theme } from "../theme/theme.ts";
import { formatKeyText } from "./keybinding-hints.ts";

const BAR_WIDTH = 24;

const TONE_COLOR = {
	accent: "accent",
	warning: "warning",
	error: "error",
	success: "success",
} as const;

function renderBar(bar: UsageBar): string {
	const frac = bar.total && bar.total > 0 ? Math.min(1, Math.max(0, bar.used / bar.total)) : 0;
	const filled = Math.round(frac * BAR_WIDTH);
	const fill = theme.fg(TONE_COLOR[bar.tone], "█".repeat(filled));
	const empty = theme.fg("muted", "░".repeat(BAR_WIDTH - filled));
	return `${fill}${empty}`;
}

/**
 * A read-only full-screen view showing account/session usage with tqdm-style
 * progress bars. Mounted through the same `showSelector` path as /settings, so
 * it appears in the editor area and Esc (or a click) closes it and restores the
 * editor.
 */
export class UsagePopupComponent implements Component, Focusable {
	focused = false;

	private readonly overview: UsageOverview;
	private readonly onClose: () => void;

	constructor(overview: UsageOverview, onClose: () => void) {
		this.overview = overview;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		const keybindings = getKeybindings();
		if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "app.clear")) {
			this.onClose();
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
		if (event.type === "click") this.onClose();
		return { handled: true, render: false };
	}

	invalidate(): void {}

	render(_width: number): string[] {
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
				out.push(`${pad}${renderBar(bar)}  ${theme.fg("dim", bar.display)}`);
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

		const closeKey = formatKeyText(getKeybindings().getKeys("tui.select.cancel")[0] ?? "escape");
		out.push("");
		out.push(theme.fg("muted", `${closeKey} to close`));

		return out;
	}
}
