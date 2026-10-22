/**
 * A provider-agnostic model for the `/usage` popup: bounded quotas render as
 * tqdm-style progress bars, key/value rows render as plain lines, and notes
 * carry warnings the UI should surface (e.g. a provider whose subscription
 * limits are not exposed through its API).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BarTone = "accent" | "warning" | "error" | "success";

export interface UsageBar {
	id: string;
	label: string;
	/** Consumed amount, in the same unit as `total`. */
	used: number;
	/** Total limit; null means unlimited or unknown. */
	total: number | null;
	/** Pre-formatted right-hand label, e.g. "4.2% / 1.0M" or "2.3h / 5h". */
	display: string;
	tone: BarTone;
	note?: string;
}

export interface UsageLine {
	label: string;
	value: string;
	tone?: BarTone;
}

export interface UsageOverview {
	providerId: string;
	modelId: string;
	bars: UsageBar[];
	lines: UsageLine[];
	notes: string[];
}

export interface DeepSeekBalanceInfo {
	currency: "CNY" | "USD";
	total_balance: string;
	granted_balance: string;
	topped_up_balance: string;
}

export interface DeepSeekBalance {
	is_available: boolean;
	balance_infos: DeepSeekBalanceInfo[];
}

export interface OpenRouterCredits {
	/** Remaining credits, in USD. */
	total_credits: number;
	/** Lifetime usage, in USD. */
	total_usage: number;
}

/** Minimal stats shape the builder needs, decoupled from AgentSession. */
export interface UsageStatsInput {
	tokens: { input: number; output: number };
	cost: number;
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

export function formatMoney(currency: string, amount: string): string {
	const value = Number.parseFloat(amount);
	const n = Number.isFinite(value) ? value : 0;
	return currency === "CNY" ? `¥${n.toFixed(2)}` : `$${n.toFixed(2)}`;
}

function contextTone(percent: number | null): BarTone {
	if (percent === null) return "accent";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "accent";
}

export function buildUsageOverview(opts: {
	providerId: string;
	modelId: string;
	stats: UsageStatsInput;
	durationMs: number | null;
	deepseekBalance: DeepSeekBalance | { error: string } | null;
	openrouterCredits: OpenRouterCredits | { error: string } | null;
	subscriptionBacked: boolean;
	accountBars?: UsageBar[];
}): UsageOverview {
	const {
		providerId,
		modelId,
		stats,
		durationMs,
		deepseekBalance,
		openrouterCredits,
		subscriptionBacked,
		accountBars,
	} = opts;

	const bars: UsageBar[] = [];
	const lines: UsageLine[] = [];
	const notes: string[] = [];

	if (accountBars) bars.push(...accountBars);

	// Context window is the one "used vs left" bar that is always available.
	const cu = stats.contextUsage;
	if (cu) {
		bars.push({
			id: "context",
			label: "Context",
			used: cu.tokens ?? 0,
			total: cu.contextWindow,
			display: `${cu.percent !== null ? `${cu.percent.toFixed(1)}%` : "?"} / ${formatTokens(cu.contextWindow)}`,
			tone: contextTone(cu.percent),
		});
	}

	// Session usage (works for every provider).
	lines.push({ label: "tokens", value: `↑${formatTokens(stats.tokens.input)} ↓${formatTokens(stats.tokens.output)}` });
	lines.push({ label: "cost", value: `$${stats.cost.toFixed(3)}` });
	if (durationMs !== null) {
		lines.push({ label: "time", value: formatDuration(durationMs) });
	}

	// Provider account quota, where the provider exposes it.
	if (deepseekBalance && "error" in deepseekBalance) {
		lines.push({ label: "balance", value: deepseekBalance.error, tone: "error" });
	} else if (deepseekBalance) {
		const infos = deepseekBalance.balance_infos ?? [];
		if (infos.length === 0) {
			lines.push({ label: "balance", value: "No balance info returned.", tone: "warning" });
		}
		for (const info of infos) {
			lines.push({
				label: `balance (${info.currency})`,
				value: `${formatMoney(info.currency, info.total_balance)} available`,
				tone: deepseekBalance.is_available ? "success" : "error",
			});
		}
	}

	// OpenRouter credits: remaining is `total_credits`, used is `total_usage`.
	if (openrouterCredits && "error" in openrouterCredits) {
		lines.push({ label: "credits", value: openrouterCredits.error, tone: "error" });
	} else if (openrouterCredits) {
		const total = openrouterCredits.total_usage + openrouterCredits.total_credits;
		bars.push({
			id: "openrouter-credits",
			label: "Credits",
			used: openrouterCredits.total_usage,
			total: total > 0 ? total : null,
			display: `$${openrouterCredits.total_credits.toFixed(2)} left`,
			tone: percentTone(total > 0 ? (openrouterCredits.total_usage / total) * 100 : 0),
		});
	}

	if (subscriptionBacked) {
		notes.push("Subscription limits (weekly / 5h) are not exposed by this provider's API. See its usage dashboard.");
	}

	return { providerId, modelId, bars, lines, notes };
}

function percentTone(percent: number): BarTone {
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "accent";
}

/**
 * Parse Claude Code's `cachedUsageUtilization` (stored in ~/.claude.json) into
 * progress bars. The `utilization` values are percentages of the limit consumed,
 * so `used = percent` and `total = 100`.
 */
export function parseClaudeUtilization(raw: unknown): UsageBar[] {
	const bars: UsageBar[] = [];
	if (!raw || typeof raw !== "object") return bars;

	const u = (raw as { utilization?: Record<string, unknown> }).utilization ?? (raw as Record<string, unknown>);
	if (!u || typeof u !== "object") return bars;

	const addPercent = (key: string, label: string) => {
		const entry = (u as Record<string, unknown>)[key];
		if (!entry || typeof entry !== "object") return;
		const percent = (entry as { utilization?: unknown }).utilization;
		if (typeof percent !== "number") return;
		bars.push({
			id: `claude-${key}`,
			label,
			used: percent,
			total: 100,
			display: `${percent.toFixed(0)}% used`,
			tone: percentTone(percent),
		});
	};

	addPercent("five_hour", "5h window");
	addPercent("seven_day", "Weekly");

	// Dollar-denominated limits (e.g. usage credits) use used_dollars / limit_dollars.
	for (const [key, value] of Object.entries(u)) {
		if (!value || typeof value !== "object") continue;
		const { used_dollars: used, limit_dollars: total } = value as {
			used_dollars?: unknown;
			limit_dollars?: unknown;
		};
		if (typeof used !== "number" || typeof total !== "number" || total <= 0) continue;
		bars.push({
			id: `claude-${key}`,
			label: "Credits",
			used,
			total,
			display: `$${used.toFixed(2)} / $${total.toFixed(2)}`,
			tone: percentTone((used / total) * 100),
		});
		break;
	}

	return bars;
}

/**
 * Read Claude Code's cached subscription usage. Claude Code itself fetches this
 * with the user's OAuth token and stores it in ~/.claude.json, so reading it is
 * a zero-network way to surface the real 5h / weekly numbers.
 */
export function readClaudeCachedUsage(): UsageBar[] | { error: string } {
	try {
		const path = join(homedir(), ".claude.json");
		if (!existsSync(path)) return { error: "~/.claude.json not found." };
		const data = JSON.parse(readFileSync(path, "utf8")) as { cachedUsageUtilization?: unknown };
		if (!data.cachedUsageUtilization) return { error: "No cached Claude usage found." };
		return parseClaudeUtilization(data.cachedUsageUtilization);
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}
