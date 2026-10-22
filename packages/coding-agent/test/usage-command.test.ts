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

describe("/usage extension command", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
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
