import { afterEach, describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

describe("InteractiveMode.handleUsageCommand", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	test("fetches the DeepSeek balance and opens the usage view with it", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					is_available: true,
					balance_infos: [
						{ currency: "USD", total_balance: "116.70", granted_balance: "0", topped_up_balance: "116.70" },
					],
				}),
			}),
		);

		const fakeThis: any = {
			openUsageView: vi.fn(),
			session: {
				model: { provider: "deepseek", id: "deepseek-v4-pro" },
				modelRuntime: {
					getAuth: vi.fn().mockResolvedValue({ auth: { apiKey: "sk-test" } }),
					isUsingSubscription: vi.fn().mockReturnValue(false),
				},
				getSessionStats: () => ({ tokens: { input: 100, output: 50 }, cost: 0.5, contextUsage: undefined }),
			},
			sessionManager: { getHeader: () => null },
		};

		await (InteractiveMode as any).prototype.handleUsageCommand.call(fakeThis);

		expect(fakeThis.openUsageView).toHaveBeenCalledTimes(1);
		const overview = fakeThis.openUsageView.mock.calls[0][0];
		expect(overview.providerId).toBe("deepseek");
		expect(overview.lines).toContainEqual({ label: "balance (USD)", value: "$116.70 available", tone: "success" });
	});

	test("reports a missing DeepSeek key without calling fetch", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const fakeThis: any = {
			openUsageView: vi.fn(),
			session: {
				model: { provider: "deepseek", id: "deepseek-v4-pro" },
				modelRuntime: {
					getAuth: vi.fn().mockResolvedValue(undefined),
					isUsingSubscription: vi.fn().mockReturnValue(false),
				},
				getSessionStats: () => ({ tokens: { input: 0, output: 0 }, cost: 0, contextUsage: undefined }),
			},
			sessionManager: { getHeader: () => null },
		};

		await (InteractiveMode as any).prototype.handleUsageCommand.call(fakeThis);

		expect(fetchMock).not.toHaveBeenCalled();
		const overview = fakeThis.openUsageView.mock.calls[0][0];
		expect(overview.lines).toContainEqual({
			label: "balance",
			value: "No DeepSeek API key configured. Run /login deepseek.",
			tone: "error",
		});
	});

	test("fetches OpenRouter credits and opens the usage view with a credits bar", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ data: { total_credits: 25.5, total_usage: 4.5 } }),
			}),
		);

		const fakeThis: any = {
			openUsageView: vi.fn(),
			session: {
				model: { provider: "openrouter", id: "anthropic/claude-sonnet-4-5" },
				modelRuntime: {
					getAuth: vi.fn().mockResolvedValue({ auth: { apiKey: "sk-or-test" } }),
					isUsingSubscription: vi.fn().mockReturnValue(false),
				},
				getSessionStats: () => ({ tokens: { input: 0, output: 0 }, cost: 0, contextUsage: undefined }),
			},
			sessionManager: { getHeader: () => null },
		};

		await (InteractiveMode as any).prototype.handleUsageCommand.call(fakeThis);

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://openrouter.ai/api/v1/credits",
			expect.objectContaining({ headers: { Authorization: "Bearer sk-or-test" } }),
		);
		const overview = fakeThis.openUsageView.mock.calls[0][0];
		expect(overview.providerId).toBe("openrouter");
		expect(overview.bars).toContainEqual({
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

		const fakeThis: any = {
			openUsageView: vi.fn(),
			session: {
				model: { provider: "openrouter", id: "anthropic/claude-sonnet-4-5" },
				modelRuntime: {
					getAuth: vi.fn().mockResolvedValue(undefined),
					isUsingSubscription: vi.fn().mockReturnValue(false),
				},
				getSessionStats: () => ({ tokens: { input: 0, output: 0 }, cost: 0, contextUsage: undefined }),
			},
			sessionManager: { getHeader: () => null },
		};

		await (InteractiveMode as any).prototype.handleUsageCommand.call(fakeThis);

		expect(fetchMock).not.toHaveBeenCalled();
		const overview = fakeThis.openUsageView.mock.calls[0][0];
		expect(overview.lines).toContainEqual({
			label: "credits",
			value: "No OpenRouter API key configured. Run /login openrouter.",
			tone: "error",
		});
	});

	test("does not call fetch for a non-DeepSeek/OpenRouter provider", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const fakeThis: any = {
			openUsageView: vi.fn(),
			session: {
				model: { provider: "openai", id: "gpt-5.6" },
				modelRuntime: {
					isUsingSubscription: vi.fn().mockReturnValue(true),
				},
				getSessionStats: () => ({ tokens: { input: 0, output: 0 }, cost: 0, contextUsage: undefined }),
			},
			sessionManager: { getHeader: () => null },
		};

		await (InteractiveMode as any).prototype.handleUsageCommand.call(fakeThis);

		expect(fetchMock).not.toHaveBeenCalled();
		const overview = fakeThis.openUsageView.mock.calls[0][0];
		expect(overview.notes).toHaveLength(1);
		expect(overview.lines).not.toContainEqual(expect.objectContaining({ label: "balance" }));
	});
});
