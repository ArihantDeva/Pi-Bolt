import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { AcpConnection } from "../src/extensions/acp/connection.ts";
import { literalConfigValue, mcpServerName, toMcpServerConfig } from "../src/extensions/acp/extension.ts";
import {
	fenced,
	promptToPi,
	replayMessages,
	stopReasonOf,
	toolCallInfo,
	toolResultContent,
} from "../src/extensions/acp/translate.ts";

const cwd = join("/", "work", "project");
const file = join(cwd, "src", "main.ts");

describe("promptToPi", () => {
	it("keeps text and links in place and puts embedded files first", () => {
		const prompt = promptToPi([
			{ type: "text", text: "Explain" },
			{ type: "resource_link", uri: pathToFileURL(file).href, name: "main.ts" },
			{ type: "text", text: " please" },
			{ type: "resource", resource: { uri: pathToFileURL(file).href, text: "export {}" } },
			{ type: "image", data: "aGk=", mimeType: "image/png" },
		]);
		expect(prompt.text).toBe(`<file name="${file}">\nexport {}\n</file>\nExplain ${file} please`);
		expect(prompt.images).toEqual([{ type: "image", data: "aGk=", mimeType: "image/png" }]);
	});

	it("passes slash commands through unchanged", () => {
		expect(promptToPi([{ type: "text", text: "/skill:review now" }]).text).toBe("/skill:review now");
	});
});

describe("toolCallInfo", () => {
	it("describes Pi's tools", () => {
		expect(toolCallInfo("read", { path: "src/main.ts", offset: 10 }, cwd)).toEqual({
			title: "Read src/main.ts",
			kind: "read",
			locations: [{ path: file, line: 10 }],
		});
		expect(toolCallInfo("edit", { path: file, edits: [] }, cwd).kind).toBe("edit");
		expect(toolCallInfo("bash", { command: "npm   test\n--watch" }, cwd)).toEqual({
			title: "npm test --watch",
			kind: "execute",
			locations: [],
		});
		expect(toolCallInfo("grep", { pattern: "TODO" }, cwd).kind).toBe("search");
		expect(toolCallInfo("my_tool", {}, cwd)).toEqual({ title: "my_tool", kind: "other", locations: [] });
	});
});

describe("tool results", () => {
	it("keeps text and images", () => {
		expect(
			toolResultContent({
				content: [
					{ type: "text", text: "ok" },
					{ type: "image", data: "aGk=", mimeType: "image/png" },
					{ type: "text", text: "" },
				],
			}),
		).toEqual([
			{ type: "content", content: { type: "text", text: "ok" } },
			{ type: "content", content: { type: "image", data: "aGk=", mimeType: "image/png" } },
		]);
	});

	it("fences output with a fence longer than any it contains", () => {
		expect(fenced("a ``` b")).toBe("````\na ``` b\n````");
	});
});

describe("history", () => {
	const messages = [
		{ role: "user", content: "hi", timestamp: 0 },
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "hmm" },
				{ type: "text", text: "Reading." },
				{ type: "toolCall", id: "t1", name: "read", arguments: { path: "src/main.ts" } },
			],
			stopReason: "toolUse",
		},
		{
			role: "toolResult",
			toolCallId: "t1",
			toolName: "read",
			content: [{ type: "text", text: "code" }],
			isError: false,
		},
		{ role: "assistant", content: [{ type: "text", text: "Done." }], stopReason: "length" },
	] as unknown as AgentMessage[];

	it("replays messages and tool calls with their results", () => {
		const updates = replayMessages(messages, cwd).map((update) => update.sessionUpdate);
		expect(updates).toEqual([
			"user_message_chunk",
			"agent_thought_chunk",
			"agent_message_chunk",
			"tool_call",
			"agent_message_chunk",
		]);
		const call = replayMessages(messages, cwd)[3];
		expect(call).toMatchObject({ status: "completed", locations: [{ path: file }] });
	});

	it("maps the last assistant stop reason", () => {
		expect(stopReasonOf(messages, false)).toBe("max_tokens");
		expect(stopReasonOf(messages, true)).toBe("cancelled");
		expect(stopReasonOf([], false)).toBe("end_turn");
	});
});

describe("editor MCP servers", () => {
	it("keeps values literal and names valid", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal config value reference
		expect(literalConfigValue("!rm -rf $HOME ${X}")).toBe("$!rm -rf $$HOME $${X}");
		expect(mcpServerName("IDE tools (JetBrains)")).toBe("IDE-tools-JetBrains");
		expect(mcpServerName("***")).toBe("server");
		expect(toMcpServerConfig({ type: "sse", name: "x", url: "http://localhost", headers: [] })).toBeUndefined();
		expect(
			toMcpServerConfig({ type: "http", name: "x", url: "http://localhost", headers: [{ name: "A", value: "$b" }] }),
		).toEqual({ type: "http", url: "http://localhost", headers: { A: "$$b" } });
	});
});

describe("AcpConnection", () => {
	const connect = () => {
		const sent: any[] = [];
		const connection = new AcpConnection({
			write: (line) => sent.push(JSON.parse(line)),
			onRequest: async (method) => {
				if (method === "boom") throw new Error("broken");
				return { ok: method };
			},
			onNotification: () => {},
		});
		return { connection, sent };
	};

	it("answers requests and errors", async () => {
		const { connection, sent } = connect();
		connection.receive('{"jsonrpc":"2.0","id":1,"method":"ping"}');
		connection.receive('{"jsonrpc":"2.0","id":2,"method":"boom"}');
		connection.receive("not json");
		await new Promise((r) => setTimeout(r, 0));
		expect(sent).toEqual([
			{ jsonrpc: "2.0", id: null, error: { code: -32700, message: expect.any(String) } },
			{ jsonrpc: "2.0", id: 1, result: { ok: "ping" } },
			{ jsonrpc: "2.0", id: 2, error: { code: -32603, message: "broken" } },
		]);
	});

	it("matches the client's responses to the agent's requests", async () => {
		const { connection, sent } = connect();
		const answer = connection.request("session/request_permission", {});
		connection.receive(
			JSON.stringify({ jsonrpc: "2.0", id: sent[0].id, result: { outcome: { outcome: "cancelled" } } }),
		);
		expect(await answer).toEqual({ outcome: { outcome: "cancelled" } });
		const failed = connection.request("x", {});
		connection.close();
		await expect(failed).rejects.toThrow("closed");
	});
});
