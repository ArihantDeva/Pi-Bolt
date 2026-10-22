import { describe, expect, it } from "vitest";
import {
	buildUsageOverview,
	formatDuration,
	formatMoney,
	formatTokens,
	parseClaudeUtilization,
} from "../src/core/usage-overview.ts";

describe("formatTokens", () => {
	it("formats compact token counts", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(5000)).toBe("5.0k");
		expect(formatTokens(200000)).toBe("200k");
		expect(formatTokens(1280000)).toBe("1.3M");
	});
});

describe("formatDuration", () => {
	it("formats durations", () => {
		expect(formatDuration(45_000)).toBe("45s");
		expect(formatDuration(90_000)).toBe("1m 30s");
		expect(formatDuration(3_723_000)).toBe("1h 2m 3s");
	});
});

describe("formatMoney", () => {
	it("formats USD and CNY", () => {
		expect(formatMoney("USD", "116.70")).toBe("$116.70");
		expect(formatMoney("CNY", "3.5")).toBe("¥3.50");
	});
});

describe("buildUsageOverview", () => {
	it("builds a context bar and session lines for a non-deepseek provider", () => {
		const overview = buildUsageOverview({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
			stats: {
				tokens: { input: 18_000, output: 5_000 },
				cost: 0.0842,
				contextUsage: { tokens: 24_561, contextWindow: 200_000, percent: 12.28 },
			},
			durationMs: 90_000,
			deepseekBalance: null,
			openrouterCredits: null,
			subscriptionBacked: true,
		});

		expect(overview.providerId).toBe("anthropic");
		expect(overview.modelId).toBe("claude-sonnet-4-5");
		expect(overview.bars).toHaveLength(1);
		expect(overview.bars[0]).toMatchObject({ id: "context", used: 24_561, total: 200_000 });
		expect(overview.bars[0].display).toBe("12.3% / 200k");
		expect(overview.lines).toEqual([
			{ label: "tokens", value: "↑18k ↓5.0k" },
			{ label: "cost", value: "$0.084" },
			{ label: "time", value: "1m 30s" },
		]);
		expect(overview.notes).toHaveLength(1);
	});

	it("surfaces a DeepSeek balance", () => {
		const overview = buildUsageOverview({
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
			stats: { tokens: { input: 0, output: 0 }, cost: 0 },
			durationMs: null,
			deepseekBalance: {
				is_available: true,
				balance_infos: [
					{ currency: "USD", total_balance: "116.70", granted_balance: "0", topped_up_balance: "116.70" },
				],
			},
			openrouterCredits: null,
			subscriptionBacked: false,
		});

		expect(overview.lines).toContainEqual({ label: "balance (USD)", value: "$116.70 available", tone: "success" });
	});

	it("surfaces a DeepSeek balance error", () => {
		const overview = buildUsageOverview({
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
			stats: { tokens: { input: 0, output: 0 }, cost: 0 },
			durationMs: null,
			deepseekBalance: { error: "HTTP 401" },
			openrouterCredits: null,
			subscriptionBacked: false,
		});

		expect(overview.lines).toContainEqual({ label: "balance", value: "HTTP 401", tone: "error" });
	});

	it("renders an OpenRouter credits bar", () => {
		const overview = buildUsageOverview({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4-5",
			stats: { tokens: { input: 0, output: 0 }, cost: 0 },
			durationMs: null,
			deepseekBalance: null,
			openrouterCredits: { total_credits: 25.5, total_usage: 4.5 },
			subscriptionBacked: false,
		});

		expect(overview.bars).toContainEqual({
			id: "openrouter-credits",
			label: "Credits",
			used: 4.5,
			total: 30,
			display: "$25.50 left",
			tone: "accent",
		});
	});

	it("surfaces an OpenRouter credits error", () => {
		const overview = buildUsageOverview({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4-5",
			stats: { tokens: { input: 0, output: 0 }, cost: 0 },
			durationMs: null,
			deepseekBalance: null,
			openrouterCredits: { error: "HTTP 401" },
			subscriptionBacked: false,
		});

		expect(overview.lines).toContainEqual({ label: "credits", value: "HTTP 401", tone: "error" });
	});

	it("colors the context bar by usage level", () => {
		const mk = (percent: number) =>
			buildUsageOverview({
				providerId: "deepseek",
				modelId: "deepseek-v4-pro",
				stats: {
					tokens: { input: 0, output: 0 },
					cost: 0,
					contextUsage: { tokens: 100, contextWindow: 200, percent },
				},
				durationMs: null,
				deepseekBalance: null,
				openrouterCredits: null,
				subscriptionBacked: false,
			});

		expect(mk(12).bars[0].tone).toBe("accent");
		expect(mk(80).bars[0].tone).toBe("warning");
		expect(mk(95).bars[0].tone).toBe("error");
	});

	it("omits the context bar when context usage is unknown", () => {
		const overview = buildUsageOverview({
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
			stats: { tokens: { input: 0, output: 0 }, cost: 0 },
			durationMs: null,
			deepseekBalance: null,
			openrouterCredits: null,
			subscriptionBacked: false,
		});

		expect(overview.bars).toEqual([]);
	});
});

describe("parseClaudeUtilization", () => {
	it("maps the 5h window, weekly, and dollar limits into bars", () => {
		const bars = parseClaudeUtilization({
			utilization: {
				five_hour: { utilization: 16, resets_at: "2026-10-22T13:30:00Z" },
				seven_day: { utilization: 52, resets_at: "2026-10-25T16:00:00Z" },
				iguana_necktie: {
					utilization: 11.386711,
					limit_dollars: 100,
					used_dollars: 11.386711,
					remaining_dollars: 88.613289,
				},
				unrelated: null,
			},
		});

		expect(bars).toEqual([
			{ id: "claude-five_hour", label: "5h window", used: 16, total: 100, display: "16% used", tone: "accent" },
			{ id: "claude-seven_day", label: "Weekly", used: 52, total: 100, display: "52% used", tone: "accent" },
			{
				id: "claude-iguana_necktie",
				label: "Credits",
				used: 11.386711,
				total: 100,
				display: "$11.39 / $100.00",
				tone: "accent",
			},
		]);
	});

	it("returns empty bars for missing or malformed data", () => {
		expect(parseClaudeUtilization(undefined)).toEqual([]);
		expect(parseClaudeUtilization({})).toEqual([]);
	});
});
