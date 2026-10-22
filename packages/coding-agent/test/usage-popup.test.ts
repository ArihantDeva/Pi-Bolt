import { describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { UsageOverview } from "../src/extensions/usage/overview.ts";
import { UsagePopupComponent } from "../src/extensions/usage/popup.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");

describe("UsagePopupComponent", () => {
	it("renders the header, a progress bar, and session/balance lines", () => {
		initTheme("dark");

		const overview: UsageOverview = {
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
			bars: [{ id: "context", label: "Context", used: 50, total: 100, display: "50.0% / 200k", tone: "accent" }],
			lines: [
				{ label: "tokens", value: "↑18k ↓5.0k" },
				{ label: "balance (USD)", value: "$116.70 available", tone: "success" },
			],
			notes: ["Subscription limits are not exposed by this provider's API."],
		};

		const text = new UsagePopupComponent(theme, new KeybindingsManager(), overview, () => {})
			.render(80)
			.map(stripAnsi)
			.join("\n");

		expect(text).toContain("Usage");
		expect(text).toContain("deepseek · deepseek-v4-pro");
		expect(text).toContain("Context");
		// 50 / 100 -> 12 of 24 blocks filled.
		expect(text).toContain("████████████");
		expect(text).toContain("░░░░░░░░░░░░");
		expect(text).toContain("50.0% / 200k");
		expect(text).toContain("↑18k ↓5.0k");
		expect(text).toContain("$116.70 available");
		expect(text).toContain("Subscription limits are not exposed");
		expect(text).toContain("to close");
	});

	it("renders a full bar at 100% and an empty bar at 0%", () => {
		initTheme("dark");

		const overview: UsageOverview = {
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4-5",
			bars: [
				{ id: "full", label: "Full", used: 100, total: 100, display: "100% used", tone: "error" },
				{ id: "empty", label: "Empty", used: 0, total: 100, display: "0% used", tone: "accent" },
			],
			lines: [],
			notes: [],
		};

		const text = new UsagePopupComponent(theme, new KeybindingsManager(), overview, () => {})
			.render(80)
			.map(stripAnsi)
			.join("\n");

		expect(text).toContain("█".repeat(24));
		expect(text).toContain("░".repeat(24));
	});
});
