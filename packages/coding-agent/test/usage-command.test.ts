import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RegisteredCommand } from "../src/core/extensions/types.ts";
import usageExtension from "../src/extensions/usage/index.ts";
import type { UsagePopupComponent } from "../src/extensions/usage/popup.ts";

interface FakeOptions {
	model?: { provider: string; id: string; baseUrl: string };
	auth?: { ok: true; apiKey?: string; baseUrl?: string } | { ok: false; error: string };
	subscription?: boolean;
}

async function runUsage(options: FakeOptions) {
	let command: Omit<RegisteredCommand, "name" | "sourceInfo"> | undefined;
	usageExtension({
		registerCommand: (_name: string, c: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
			command = c;
		},
	} as never);

	let overview: ConstructorParameters<typeof UsagePopupComponent>[2] | undefined;
	const notify = vi.fn();
	const ctx = {
		mode: "tui",
		model: options.model,
		getContextUsage: () => undefined,
		sessionManager: { getEntries: () => [], getHeader: () => null },
		modelRegistry: {
			getApiKeyAndHeaders: vi.fn().mockResolvedValue(options.auth ?? { ok: true, apiKey: "sk-test" }),
			isUsingOAuth: () => options.subscription === true,
			getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
		},
		ui: {
			notify,
			custom: async (factory: (...args: unknown[]) => UsagePopupComponent) => {
				const component = factory({}, {}, { matches: () => false, getKeys: () => [] }, () => {});
				overview = (component as unknown as { overview: typeof overview }).overview;
			},
		},
	};
	await command!.handler("", ctx as never);
	return { overview, notify, ctx };
}

/** Point the home directory at a temp dir holding `claudeJson` as ~/.claude.json (none when undefined). */
function stubHome(claudeJson?: unknown): string {
	const home = mkdtempSync(join(tmpdir(), "pi-usage-home-"));
	if (claudeJson !== undefined) writeFileSync(join(home, ".claude.json"), JSON.stringify(claudeJson));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	return home;
}

describe("/usage extension command", () => {
	let home: string | undefined;

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		if (home) rmSync(home, { recursive: true, force: true });
		home = undefined;
	});

	const anthropic = { provider: "anthropic", id: "claude-sonnet-4-5", baseUrl: "https://api.anthropic.com" };
	const claudeCache = (fetchedAtMs?: number) => ({
		cachedUsageUtilization: {
			fetchedAtMs,
			utilization: { five_hour: { utilization: 16 }, seven_day: { utilization: 52 } },
		},
	});

	test("shows Claude Code's cached limits with their age for a Claude subscription", async () => {
		home = stubHome(claudeCache(Date.now() - 12 * 60_000 - 5_000));

		const { overview } = await runUsage({ model: anthropic, subscription: true });

		expect(overview?.bars).toContainEqual(expect.objectContaining({ id: "claude-five_hour", used: 16 }));
		expect(overview?.bars).toContainEqual(expect.objectContaining({ id: "claude-seven_day", used: 52 }));
		expect(overview?.lines).toContainEqual({
			label: "limits",
			value: "Claude Code's cached numbers, from 12 min ago",
		});
		expect(overview?.notes).toHaveLength(0);
	});

	test("says the age is unknown when the cache has no fetch time", async () => {
		home = stubHome(claudeCache());

		const { overview } = await runUsage({ model: anthropic, subscription: true });

		expect(overview?.lines).toContainEqual({ label: "limits", value: "Claude Code's cached numbers, age unknown" });
	});

	test("ignores Claude Code's cache with an Anthropic API key", async () => {
		home = stubHome(claudeCache(Date.now()));

		const { overview } = await runUsage({ model: anthropic, subscription: false });

		expect(overview?.bars).not.toContainEqual(expect.objectContaining({ id: "claude-five_hour" }));
		expect(overview?.lines).not.toContainEqual(expect.objectContaining({ label: "limits" }));
	});

	test("reports a missing ~/.claude.json for a Claude subscription", async () => {
		home = stubHome();

		const { overview } = await runUsage({ model: anthropic, subscription: true });

		expect(overview?.lines).toContainEqual({ label: "limits", value: "~/.claude.json not found.", tone: "warning" });
	});

	test("fetches the DeepSeek balance from the configured base URL", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				is_available: true,
				balance_infos: [
					{ currency: "USD", total_balance: "116.70", granted_balance: "0", topped_up_balance: "116.70" },
				],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { overview } = await runUsage({
			model: { provider: "deepseek", id: "deepseek-v4-pro", baseUrl: "https://api.deepseek.com/anthropic" },
			auth: { ok: true, apiKey: "sk-test", baseUrl: "https://proxy.example.com/deepseek" },
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://proxy.example.com/user/balance",
			expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } }),
		);
		expect(overview?.lines).toContainEqual({ label: "balance (USD)", value: "$116.70 available", tone: "success" });
	});

	test("falls back to the model base URL when auth has none", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ balance_infos: [] }) });
		vi.stubGlobal("fetch", fetchMock);

		await runUsage({ model: { provider: "deepseek", id: "m", baseUrl: "https://api.deepseek.com" } });

		expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/user/balance");
	});

	test("reports a missing DeepSeek key without calling fetch", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const { overview } = await runUsage({
			model: { provider: "deepseek", id: "m", baseUrl: "https://api.deepseek.com" },
			auth: { ok: false, error: "none" },
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(overview?.lines).toContainEqual({
			label: "balance",
			value: "No DeepSeek API key configured. Run /login deepseek.",
			tone: "error",
		});
	});

	test("fetches OpenRouter credits from the configured origin and shows a credits bar", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ data: { total_credits: 25.5, total_usage: 4.5 } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { overview } = await runUsage({
			model: { provider: "openrouter", id: "m", baseUrl: "https://us.openrouter.ai/api" },
			auth: { ok: true, apiKey: "sk-or-test" },
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://us.openrouter.ai/api/v1/credits",
			expect.objectContaining({ headers: { Authorization: "Bearer sk-or-test" } }),
		);
		expect(overview?.bars).toContainEqual({
			id: "openrouter-credits",
			label: "Credits",
			used: 4.5,
			total: 30,
			display: "$25.50 left",
			tone: "accent",
		});
	});

	test("reports a missing OpenRouter key without calling fetch", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const { overview } = await runUsage({
			model: { provider: "openrouter", id: "m", baseUrl: "https://openrouter.ai/api" },
			auth: { ok: false, error: "none" },
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(overview?.lines).toContainEqual({
			label: "credits",
			value: "No OpenRouter API key configured. Run /login openrouter.",
			tone: "error",
		});
	});

	test("fetches Codex limits with the account id from the token", async () => {
		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } }),
		).toString("base64url");
		const token = `h.${payload}.s`;
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 } } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { overview } = await runUsage({
			model: { provider: "openai-codex", id: "m", baseUrl: "https://chatgpt.com/backend-api" },
			auth: { ok: true, apiKey: token },
			subscription: true,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/wham/usage",
			expect.objectContaining({ headers: { Authorization: `Bearer ${token}`, "chatgpt-account-id": "acct-1" } }),
		);
		expect(overview?.bars).toContainEqual(
			expect.objectContaining({ id: "codex-primary_window", label: "5h window" }),
		);
		expect(overview?.notes).toHaveLength(0);
	});

	test("shows an error line when the Codex token has no account id", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const { overview } = await runUsage({
			model: { provider: "openai-codex", id: "m", baseUrl: "https://chatgpt.com/backend-api" },
			auth: { ok: true, apiKey: "not-a-jwt" },
			subscription: true,
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(overview?.lines).toContainEqual(expect.objectContaining({ label: "limits", tone: "error" }));
	});

	test("does not call fetch for other providers", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const { overview } = await runUsage({
			model: { provider: "openai", id: "gpt-5.6", baseUrl: "https://api.openai.com/v1" },
			subscription: true,
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(overview?.notes).toHaveLength(1);
		expect(overview?.lines).not.toContainEqual(expect.objectContaining({ label: "balance" }));
	});

	test("notifies instead of assuming a provider when no model is selected", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const { overview, notify } = await runUsage({});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(overview).toBeUndefined();
		expect(notify).toHaveBeenCalledWith("No model selected.", "warning");
	});
});
