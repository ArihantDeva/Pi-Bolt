import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Message,
	type Model,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../src/agent-loop.ts";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	EarlyToolExecution,
} from "../src/types.ts";

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(m) => m.role === "system" || m.role === "user" || m.role === "assistant" || m.role === "toolResult",
	) as Message[];
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function call(id: string, name: string, args: Record<string, string>): ToolCall {
	return { type: "toolCall", id, name, arguments: args };
}

interface Script {
	content: AssistantMessage["content"];
	stopReason?: AssistantMessage["stopReason"];
	/** Streamed JSON arguments by tool call id, when they are not the final arguments. */
	streamed?: Record<string, string>;
	/** Run after the last content event, before the message ends. */
	beforeEnd?: () => Promise<void> | void;
}

/** Streams `script` as a provider would, one event per timer tick, then a plain answer for the next request. */
function scriptedStreamFn(script: Script) {
	let requests = 0;
	return (_model: Model<any>, _context: unknown, options?: { signal?: AbortSignal }) => {
		const stream = createAssistantMessageEventStream();
		const first = requests++ === 0;
		void (async () => {
			if (!first) {
				stream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "finished" }], "stop"),
				});
				return;
			}
			const stopReason = script.stopReason ?? "toolUse";
			const partial = createAssistantMessage([], stopReason);
			stream.push({ type: "start", partial });
			for (const [index, block] of script.content.entries()) {
				await tick();
				if (block.type === "text") {
					partial.content.push({ type: "text", text: "" });
					stream.push({ type: "text_start", contentIndex: index, partial });
					for (const word of block.text.split(/(?= )/)) {
						await tick();
						(partial.content[index] as { text: string }).text += word;
						stream.push({ type: "text_delta", contentIndex: index, delta: word, partial });
					}
					stream.push({ type: "text_end", contentIndex: index, content: block.text, partial });
				} else if (block.type === "toolCall") {
					partial.content.push({ type: "toolCall", id: block.id, name: block.name, arguments: {} });
					stream.push({ type: "toolcall_start", contentIndex: index, partial });
					const json = script.streamed?.[block.id] ?? JSON.stringify(block.arguments);
					for (let at = 0; at < json.length; at += 4) {
						await tick();
						stream.push({ type: "toolcall_delta", contentIndex: index, delta: json.slice(at, at + 4), partial });
					}
					await tick();
					partial.content[index] = block;
					stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial });
				}
			}
			await script.beforeEnd?.();
			await tick();
			if (options?.signal?.aborted) {
				const aborted = createAssistantMessage(partial.content, "aborted");
				stream.push({ type: "error", reason: "aborted", error: aborted });
				return;
			}
			const final = createAssistantMessage(script.content, stopReason);
			stream.push({ type: "done", reason: stopReason as "toolUse", message: final });
		})();
		return stream;
	};
}

interface Execution {
	id: string;
	key: string;
	signal: AbortSignal | undefined;
	finished: boolean;
}

const lookupSchema = Type.Object({ key: Type.String() });

/** A side-effect-free tool that records its executions. */
function createLookupTool(
	executions: Execution[],
	options: { name?: string; updates?: boolean; delayMs?: (key: string) => number } = {},
): AgentTool<typeof lookupSchema> {
	return {
		name: options.name ?? "lookup",
		label: "Lookup",
		description: "Look up a key",
		parameters: lookupSchema,
		async execute(id, params, signal, onUpdate) {
			const execution: Execution = { id, key: params.key, signal, finished: false };
			executions.push(execution);
			if (options.updates)
				onUpdate?.({ content: [{ type: "text", text: `looking up ${params.key}` }], details: {} });
			await new Promise((resolve) => setTimeout(resolve, options.delayMs?.(params.key) ?? 1));
			if (signal?.aborted) throw new Error("Operation aborted");
			execution.finished = true;
			return { content: [{ type: "text", text: `value of ${params.key}` }], details: { key: params.key } };
		},
	};
}

const startEarly: EarlyToolExecution = (_toolCall, tool) => (tool.name === "lookup" ? () => true : undefined);

async function run(
	script: Script,
	tools: AgentTool[],
	config: Partial<AgentLoopConfig> = {},
	controller = new AbortController(),
): Promise<{ events: AgentEvent[]; messages: AgentMessage[] }> {
	const context: AgentContext = { messages: [], tools };
	const events: AgentEvent[] = [];
	const messages = await runAgentLoop(
		[{ role: "user", content: "go", timestamp: 1 }],
		context,
		{ model: createModel(), convertToLlm, ...config },
		(event) => {
			events.push(event);
		},
		controller.signal,
		scriptedStreamFn(script),
	);
	return { events, messages };
}

/** Events as the loop's listeners see them, without the run's timings. */
function normalize(events: AgentEvent[]): unknown[] {
	return events.map((event) => {
		const copy = JSON.parse(JSON.stringify(event));
		const strip = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			const record = value as Record<string, unknown>;
			delete record.durationMs;
			delete record.timestamp;
			for (const child of Object.values(record)) strip(child);
		};
		strip(copy);
		return copy;
	});
}

function toolResultTexts(messages: AgentMessage[]): string[] {
	return messages.flatMap((message) =>
		message.role === "toolResult" ? [(message.content[0] as { text: string }).text] : [],
	);
}

describe("early tool execution", () => {
	it("starts a call before the message ends and uses its result, with the same events", async () => {
		const script: Script = {
			content: [call("c1", "lookup", { key: "a" }), { type: "text", text: "and some text after the call" }],
		};
		let startedBeforeEnd = 0;
		const executions: Execution[] = [];
		const early = await run(
			{
				...script,
				beforeEnd: () => {
					startedBeforeEnd = executions.length;
				},
			},
			[createLookupTool(executions)],
			{ earlyToolExecution: startEarly },
		);
		expect(startedBeforeEnd).toBe(1);
		expect(executions.map((e) => [e.key, e.finished, e.signal?.aborted])).toEqual([["a", true, false]]);
		expect(toolResultTexts(early.messages)).toEqual(["value of a"]);

		const plainExecutions: Execution[] = [];
		const plain = await run(script, [createLookupTool(plainExecutions)]);
		expect(plainExecutions).toHaveLength(1);
		expect(normalize(early.events)).toEqual(normalize(plain.events));
		const durations = early.events.flatMap((event) =>
			event.type === "tool_execution_end" ? [event.durationMs] : [],
		);
		expect(durations).toHaveLength(1);
		expect(typeof durations[0]).toBe("number");
	});

	it("starts parallel calls early and keeps completion and source order", async () => {
		const script: Script = {
			content: [
				call("c1", "lookup", { key: "slow" }),
				call("c2", "lookup", { key: "fast" }),
				call("c3", "lookup", { key: "mid" }),
			],
		};
		const delayMs = (key: string) => ({ slow: 400, fast: 1, mid: 200 })[key] ?? 1;
		let startedBeforeEnd: string[] = [];
		const executions: Execution[] = [];
		const early = await run(
			{
				...script,
				beforeEnd: () => {
					startedBeforeEnd = executions.map((e) => e.key);
				},
			},
			[createLookupTool(executions, { delayMs })],
			{ earlyToolExecution: startEarly },
		);
		expect(startedBeforeEnd).toEqual(["slow", "fast", "mid"]);
		expect(executions).toHaveLength(3);
		expect(toolResultTexts(early.messages)).toEqual(["value of slow", "value of fast", "value of mid"]);
		const ends = early.events.flatMap((event) => (event.type === "tool_execution_end" ? [event.toolCallId] : []));
		expect(ends).toEqual(["c2", "c3", "c1"]);
	});

	it("keeps sequential execution's events", async () => {
		const script: Script = { content: [call("c1", "lookup", { key: "a" }), call("c2", "lookup", { key: "b" })] };
		const executions: Execution[] = [];
		let startedBeforeEnd = 0;
		const early = await run(
			{
				...script,
				beforeEnd: () => {
					startedBeforeEnd = executions.length;
				},
			},
			[createLookupTool(executions)],
			{ earlyToolExecution: startEarly, toolExecution: "sequential" },
		);
		expect(startedBeforeEnd).toBe(2);
		const plain = await run(script, [createLookupTool([])], { toolExecution: "sequential" });
		expect(normalize(early.events)).toEqual(normalize(plain.events));
		const toolEvents = early.events.flatMap((event) =>
			event.type === "tool_execution_start" || event.type === "tool_execution_end"
				? [`${event.type}:${event.toolCallId}`]
				: [],
		);
		expect(toolEvents).toEqual([
			"tool_execution_start:c1",
			"tool_execution_end:c1",
			"tool_execution_start:c2",
			"tool_execution_end:c2",
		]);
	});

	it("does not start a call that follows one that cannot start early", async () => {
		const executions: Execution[] = [];
		const writes: Execution[] = [];
		let startedBeforeEnd: string[] = [];
		const { messages } = await run(
			{
				content: [
					call("c1", "lookup", { key: "a" }),
					call("c2", "write", { key: "w" }),
					call("c3", "lookup", { key: "b" }),
				],
				beforeEnd: () => {
					startedBeforeEnd = [...executions, ...writes].map((e) => e.key);
				},
			},
			[createLookupTool(executions), createLookupTool(writes, { name: "write" })],
			{ earlyToolExecution: startEarly },
		);
		expect(startedBeforeEnd).toEqual(["a"]);
		expect(executions.map((e) => e.key)).toEqual(["a", "b"]);
		expect(writes.map((e) => e.key)).toEqual(["w"]);
		expect(toolResultTexts(messages)).toEqual(["value of a", "value of w", "value of b"]);
	});

	it("restarts a call when the provider's final arguments differ from the streamed ones", async () => {
		const executions: Execution[] = [];
		const { messages } = await run(
			{ content: [call("c1", "lookup", { key: "final" })], streamed: { c1: '{"key":"streamed"}' } },
			[createLookupTool(executions)],
			{ earlyToolExecution: startEarly },
		);
		expect(executions.map((e) => [e.key, e.signal?.aborted])).toEqual([
			["streamed", true],
			["final", false],
		]);
		expect(toolResultTexts(messages)).toEqual(["value of final"]);
	});

	it("discards the early run when beforeToolCall changes the arguments", async () => {
		const executions: Execution[] = [];
		const { messages } = await run(
			{ content: [call("c1", "lookup", { key: "a" })] },
			[createLookupTool(executions)],
			{
				earlyToolExecution: startEarly,
				beforeToolCall: async ({ args }) => {
					(args as { key: string }).key = "changed";
					return undefined;
				},
			},
		);
		expect(executions.map((e) => [e.key, e.signal?.aborted])).toEqual([
			["a", true],
			["changed", false],
		]);
		expect(toolResultTexts(messages)).toEqual(["value of changed"]);
	});

	it("discards the early run of a call beforeToolCall blocks", async () => {
		const executions: Execution[] = [];
		const { messages, events } = await run(
			{ content: [call("c1", "lookup", { key: "a" })] },
			[createLookupTool(executions, { delayMs: () => 20 })],
			{
				earlyToolExecution: startEarly,
				beforeToolCall: async () => ({ block: true, reason: "not allowed" }),
			},
		);
		expect(executions).toHaveLength(1);
		expect(executions[0].signal?.aborted).toBe(true);
		expect(toolResultTexts(messages)).toEqual(["not allowed"]);
		expect(events.some((event) => event.type === "tool_execution_update")).toBe(false);
	});

	it("runs the call again when the early result is no longer valid", async () => {
		const executions: Execution[] = [];
		let valid = true;
		const { messages } = await run(
			{
				content: [call("c1", "lookup", { key: "a" })],
				beforeEnd: () => {
					valid = false;
				},
			},
			[createLookupTool(executions)],
			{ earlyToolExecution: (_toolCall, tool) => (tool.name === "lookup" ? () => valid : undefined) },
		);
		expect(executions.map((e) => e.key)).toEqual(["a", "a"]);
		expect(executions[0].signal?.aborted).toBe(true);
		expect(toolResultTexts(messages)).toEqual(["value of a"]);
	});

	it("aborts early runs when the run is aborted while the message streams", async () => {
		const executions: Execution[] = [];
		const controller = new AbortController();
		const { messages, events } = await run(
			{
				content: [call("c1", "lookup", { key: "a" }), { type: "text", text: "more text" }],
				beforeEnd: () => controller.abort(),
			},
			[createLookupTool(executions, { delayMs: () => 50 })],
			{ earlyToolExecution: startEarly },
			controller,
		);
		expect(executions).toHaveLength(1);
		expect(executions[0].signal?.aborted).toBe(true);
		expect(events.some((event) => event.type.startsWith("tool_execution"))).toBe(false);
		expect(messages.some((message) => message.role === "toolResult")).toBe(false);
	});

	it("drops early runs of a message cut off by the token limit", async () => {
		const executions: Execution[] = [];
		const { messages } = await run(
			{ content: [call("c1", "lookup", { key: "a" })], stopReason: "length" },
			[createLookupTool(executions, { delayMs: () => 20 })],
			{ earlyToolExecution: startEarly },
		);
		expect(executions).toHaveLength(1);
		expect(executions[0].signal?.aborted).toBe(true);
		expect(toolResultTexts(messages)[0]).toContain("output token limit");
	});

	it("passes on updates of an early run after tool_execution_start", async () => {
		const script: Script = { content: [call("c1", "lookup", { key: "a" }), { type: "text", text: "text after" }] };
		const executions: Execution[] = [];
		let startedBeforeEnd = 0;
		const early = await run(
			{
				...script,
				beforeEnd: () => {
					startedBeforeEnd = executions.length;
				},
			},
			[createLookupTool(executions, { updates: true })],
			{ earlyToolExecution: startEarly },
		);
		expect(startedBeforeEnd).toBe(1);
		const plain = await run(script, [createLookupTool([], { updates: true })]);
		expect(normalize(early.events)).toEqual(normalize(plain.events));
		const types = early.events.map((event) => event.type).filter((type) => type.startsWith("tool_execution"));
		expect(types).toEqual(["tool_execution_start", "tool_execution_update", "tool_execution_end"]);
	});
});
