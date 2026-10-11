import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { stream as streamCompletions } from "../src/api/openai-completions.ts";
import type {
	AssistantMessage,
	Context,
	Message,
	Model,
	OpenAICompletionsCompat,
	ToolResultMessage,
	Usage,
} from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

// openai-completions writes the request body itself (stringifyRequestBody), with the JSON of long strings of finished
// messages cached. The request must be what the SDK sends when it serializes the body: the same bytes and headers, on the
// first request and on later ones that use the cache, whatever an onPayload hook does to the body.

const mode = vi.hoisted(() => ({ sdk: false, serialized: 0 }));

vi.mock("../src/utils/request-json.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/utils/request-json.ts")>();
	return {
		...actual,
		stringifyRequestBody: (body: object) => {
			if (mode.sdk) return undefined;
			const json = actual.stringifyRequestBody(body);
			if (json !== undefined) mode.serialized++;
			return json;
		},
	};
});

interface CapturedRequest {
	url: string;
	method: string;
	headers: Array<[string, string]>;
	body: string;
}

function capturingFetch(requests: CapturedRequest[]): typeof fetch {
	return (async (url: string | URL, init?: RequestInit) => {
		const headers = [...new Headers(init?.headers).entries()].filter(
			([name]) => name !== "x-stainless-retry-count" && name !== "idempotency-key",
		);
		requests.push({ url: String(url), method: String(init?.method), headers, body: String(init?.body) });
		const sse = `data: ${JSON.stringify({ id: "c", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
		return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
	}) as unknown as typeof fetch;
}

const usage: Usage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function model(compat?: OpenAICompletionsCompat, provider = "fake"): Model<"openai-completions"> {
	return {
		id: "fake-model",
		name: "Fake",
		api: "openai-completions",
		provider,
		baseUrl: "http://127.0.0.1:9/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
		...(compat ? { compat } : {}),
	};
}

const longText = (seed: string) =>
	`${seed}: ${'line "quoted" \\ back\tslash\u0001 é 𝄞 \ud800 lone\n'.repeat(80)}${"x".repeat(2000)}`;

function assistant(content: AssistantMessage["content"], extra: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "fake",
		model: "fake-model",
		usage,
		stopReason: "toolUse",
		timestamp: 1,
		...extra,
	};
}

function toolResult(id: string, content: ToolResultMessage["content"]): ToolResultMessage {
	return { role: "toolResult", toolCallId: id, toolName: "read", content, isError: false, timestamp: 2 };
}

function conversation(): Message[] {
	return [
		{ role: "user", content: longText("prompt"), timestamp: 1 },
		assistant([
			{ type: "thinking", thinking: longText("thinking"), thinkingSignature: "reasoning_content" },
			{ type: "text", text: longText("answer") },
			{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.ts", content: longText("args") } },
			{ type: "toolCall", id: "call_2", name: "read", arguments: { path: "b.ts" } },
		]),
		toolResult("call_1", [{ type: "text", text: longText("result one") }]),
		toolResult("call_2", [
			{ type: "text", text: longText("result two a") },
			{ type: "text", text: longText("result two b") },
			{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
		]),
		// From another model: its blocks are copied for this one.
		assistant([{ type: "text", text: longText("other model") }], {
			provider: "other",
			model: "m",
			stopReason: "stop",
		}),
		assistant([{ type: "text", text: "errored" }], { stopReason: "error" }),
		{
			role: "user",
			content: [
				{ type: "text", text: longText("user parts") },
				{ type: "image", data: "aW1n", mimeType: "image/jpeg" },
			],
			timestamp: 3,
		},
		assistant([{ type: "toolCall", id: "call_3|item", name: "read", arguments: { path: longText("p") } }]),
		toolResult("call_3|item", [{ type: "text", text: "" }]),
		{ role: "user", content: "short", timestamp: 4 },
	];
}

const tools = [
	{
		name: "read",
		description: "Read a file",
		parameters: Type.Object({ path: Type.String(), content: Type.Optional(Type.String()) }),
	},
];

type OnPayload = (payload: unknown) => unknown;

async function send(
	context: Context,
	m: Model<"openai-completions">,
	onPayload?: OnPayload,
): Promise<{ requests: CapturedRequest[]; error?: string }> {
	const requests: CapturedRequest[] = [];
	const message = await streamCompletions(m, normalizeContext(context), {
		apiKey: "k",
		fetch: capturingFetch(requests),
		maxRetries: 0,
		sessionId: "session-1",
		...(onPayload ? { onPayload } : {}),
	}).result();
	return { requests, error: message.stopReason === "error" ? message.errorMessage : undefined };
}

async function expectSameRequest(
	context: Context,
	m: Model<"openai-completions">,
	onPayload?: OnPayload,
	serializedByPi = true,
) {
	mode.sdk = true;
	const expected = await send(context, m, onPayload);
	mode.sdk = false;
	const serializedBefore = mode.serialized;
	const first = await send(context, m, onPayload);
	// The same messages again: their strings now come from the cache.
	const second = await send(context, m, onPayload);
	expect(first).toEqual(expected);
	expect(second).toEqual(expected);
	expect(mode.serialized - serializedBefore).toBe(serializedByPi ? 2 : 0);
	return expected;
}

describe("openai-completions sends the body the SDK would", () => {
	it("a conversation with long tool results, tool calls, thinking, images and other models' messages", async () => {
		const context: Context = { systemPrompt: longText("system"), messages: conversation(), tools };
		const { requests } = await expectSameRequest(context, model());
		expect(requests).toHaveLength(1);
		expect(requests[0].body.length).toBeGreaterThan(20_000);
	});

	it("with compat options that change the messages", async () => {
		const context: Context = { systemPrompt: "sys", messages: conversation(), tools };
		await expectSameRequest(
			context,
			model({
				requiresAssistantAfterToolResult: true,
				requiresToolResultName: true,
				requiresThinkingAsText: true,
				requiresReasoningContentOnAssistantMessages: true,
				supportsDeveloperRole: false,
			}),
		);
		await expectSameRequest(context, model({ cacheControlFormat: "anthropic" }));
		await expectSameRequest(context, model(undefined, "openrouter"));
	});

	it("when onPayload changes the body in place or replaces it", async () => {
		const context: Context = { systemPrompt: "sys", messages: conversation(), tools };
		const mutateContent: OnPayload = (payload) => {
			const body = payload as { messages: Array<{ role: string; content: unknown }> };
			for (const message of body.messages) {
				if (message.role === "tool" && typeof message.content === "string") message.content = `${message.content}!`;
			}
			return undefined;
		};
		await expectSameRequest(context, model(), mutateContent);
		await expectSameRequest(context, model(), (payload) => JSON.parse(JSON.stringify(payload)));
		// A Date below a member is serialized by JSON.stringify() with that member; a toJSON method on a member itself,
		// which gets the member's key, is left to the SDK.
		await expectSameRequest(context, model(), (payload) => ({ ...(payload as object), extra: { at: new Date(0) } }));
		await expectSameRequest(context, model(), (payload) => ({ ...(payload as object), at: new Date(0) }), false);
		await expectSameRequest(
			context,
			model(),
			(payload) => {
				const body = payload as { messages: Array<Record<string, unknown>> };
				body.messages[1].content = { toJSON: (key: string) => `key:${key}` };
				return undefined;
			},
			false,
		);
		await expectSameRequest(context, model(), (payload) => {
			const body = payload as { messages: Array<Record<string, unknown>> };
			body.messages[2].dropped = undefined;
			body.messages[2].fn = () => 1;
			body.messages[2].list = [undefined, () => 1, Symbol("s"), Number.NaN, -0, new Number(5), new String("s")];
			return undefined;
		});
		const failed = await expectSameRequest(
			context,
			model(),
			(payload) => ({ ...(payload as object), big: BigInt(1) }),
			false,
		);
		expect(failed.error).toBeDefined();
	});

	it("when the messages change between requests", async () => {
		const messages = conversation();
		const context: Context = { systemPrompt: "sys", messages, tools };
		await expectSameRequest(context, model());
		// A finished message changed in place: its strings must not come from the cache.
		const result = messages[2] as ToolResultMessage;
		(result.content[0] as { text: string }).text = longText("changed");
		const user = messages[0] as { content: string };
		user.content = longText("changed prompt");
		await expectSameRequest(context, model());
	});
});
