import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";

const cliPath = resolve(__dirname, "../src/cli.ts");
// --import takes a module specifier, not a filesystem path.
const sourceResolverUrl = pathToFileURL(resolve(__dirname, "../src/experimental/source-resolver.ts")).href;
/** A built executable to test instead of the sources, such as Pi-Bolt's `out/pi-bolt/pi`. */
const executable = process.env.PI_ACP_TEST_EXECUTABLE;

// ============================================================================
// A fake OpenAI-compatible model: the last user message picks a script, one step per model turn.
// ============================================================================

type Step = { text?: string; tool?: { name: string; args: Record<string, unknown> }; hang?: boolean };

const SCRIPTS: Record<string, Step[]> = {
	tools: [
		{ text: "Writing. ", tool: { name: "write", args: { path: "notes.txt", content: "alpha\nbeta\n" } } },
		{ tool: { name: "edit", args: { path: "notes.txt", edits: [{ oldText: "beta", newText: "gamma" }] } } },
		{ tool: { name: "bash", args: { command: "echo from-bash" } } },
		{ text: "All done." },
	],
	hello: [{ text: "Hello from the fake model." }],
	slow: [{ hang: true }],
};

function sse(delta: Record<string, unknown>, finish: string | null = null): string {
	return `data: ${JSON.stringify({
		id: "fake",
		object: "chat.completion.chunk",
		model: "fake-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	})}\n\n`;
}

function startFakeModel(): Promise<Server> {
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			if (req.method !== "POST") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ object: "list", data: [{ id: "fake-model", object: "model" }] }));
				return;
			}
			const request = JSON.parse(body || "{}") as { messages?: Array<{ role: string; content: unknown }> };
			let turn = 0;
			let prompt = "";
			for (const message of request.messages ?? []) {
				if (message.role === "user") {
					turn = 0;
					prompt = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
				} else if (message.role === "tool") {
					turn++;
				}
			}
			const script = SCRIPTS[Object.keys(SCRIPTS).find((name) => prompt.includes(`[${name}]`)) ?? "hello"];
			const step = script[Math.min(turn, script.length - 1)];
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(sse({ role: "assistant", content: "" }));
			if (step.hang) return; // Never answers: the client cancels.
			if (step.text) res.write(sse({ content: step.text }));
			if (step.tool) {
				res.write(
					sse({
						tool_calls: [
							{
								index: 0,
								id: `call_${turn}`,
								type: "function",
								function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) },
							},
						],
					}),
				);
				res.write(sse({}, "tool_calls"));
			} else {
				res.write(sse({}, "stop"));
			}
			res.end("data: [DONE]\n\n");
		});
	});
	return new Promise((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise(server)));
}

// ============================================================================
// A minimal ACP client over the child's stdio
// ============================================================================

type Message = { jsonrpc: "2.0"; id?: number; method?: string; params?: any; result?: any; error?: any };

class AcpTestClient {
	readonly child: ChildProcessWithoutNullStreams;
	readonly updates: Array<{ sessionId: string; update: any }> = [];
	readonly clientRequests: Message[] = [];
	stderr = "";
	private buffer = "";
	private nextId = 1;
	private readonly pending = new Map<number, { resolve: (m: Message) => void }>();
	/** Answers the agent's requests (permission, elicitation). */
	onRequest: (message: Message) => unknown = () => ({ outcome: { outcome: "cancelled" } });

	constructor(cwd: string, agentDir: string, args: string[] = []) {
		const command = executable
			? { file: executable, args: ["--acp", ...args] }
			: { file: process.execPath, args: ["--import", sourceResolverUrl, cliPath, "--acp", ...args] };
		this.child = spawn(command.file, command.args, {
			cwd,
			env: { ...process.env, [ENV_AGENT_DIR]: agentDir, PI_OFFLINE: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk: string) => {
			this.buffer += chunk;
			for (let index = this.buffer.indexOf("\n"); index !== -1; index = this.buffer.indexOf("\n")) {
				const line = this.buffer.slice(0, index);
				this.buffer = this.buffer.slice(index + 1);
				if (line.trim()) this.handle(JSON.parse(line) as Message);
			}
		});
		this.child.stderr.on("data", (chunk) => {
			this.stderr += chunk.toString();
		});
	}

	private handle(message: Message): void {
		if (message.method && message.id !== undefined) {
			this.clientRequests.push(message);
			const result = this.onRequest(message);
			this.write({ jsonrpc: "2.0", id: message.id, result });
		} else if (message.method === "session/update") {
			this.updates.push(message.params);
		} else if (message.id !== undefined) {
			this.pending.get(message.id)?.resolve(message);
			this.pending.delete(message.id);
		}
	}

	private write(message: Message): void {
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	call(method: string, params: unknown): Promise<Message> {
		const id = this.nextId++;
		return new Promise((resolvePromise) => {
			this.pending.set(id, { resolve: resolvePromise });
			this.write({ jsonrpc: "2.0", id, method, params });
		});
	}

	async request(method: string, params: unknown): Promise<any> {
		const response = await this.call(method, params);
		if (response.error) throw new Error(`${method}: ${JSON.stringify(response.error)}\n${this.stderr}`);
		return response.result;
	}

	notify(method: string, params: unknown): void {
		this.write({ jsonrpc: "2.0", method, params });
	}

	async waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!predicate()) {
			if (Date.now() > deadline) throw new Error(`timed out\n${this.stderr}`);
			await new Promise((r) => setTimeout(r, 20));
		}
	}

	updatesOf(kind: string): any[] {
		return this.updates.filter((u) => u.update.sessionUpdate === kind).map((u) => u.update);
	}

	async stop(): Promise<number | null> {
		this.child.stdin.end();
		return new Promise((resolvePromise) => {
			if (this.child.exitCode !== null) resolvePromise(this.child.exitCode);
			else this.child.once("exit", (code) => resolvePromise(code));
		});
	}
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: a value from the editor, which must reach the server unexpanded
const EDITOR_TOKEN = "!a$b${HOME}";

const CLIENT_CAPABILITIES = { session: { notices: {} }, elicitation: { form: {} } };

describe("ACP mode", () => {
	let server: Server;
	let root: string;
	let agentDir: string;
	let projectDir: string;
	const clients: AcpTestClient[] = [];

	const startClient = async (args: string[] = []) => {
		const client = new AcpTestClient(projectDir, agentDir, args);
		clients.push(client);
		const init = await client.request("initialize", {
			protocolVersion: 1,
			clientCapabilities: CLIENT_CAPABILITIES,
			clientInfo: { name: "test-client", version: "1.0.0" },
		});
		return { client, init };
	};

	beforeAll(async () => {
		server = await startFakeModel();
		const { port } = server.address() as AddressInfo;
		root = mkdtempSync(join(tmpdir(), "pi-acp-"));
		agentDir = join(root, "agent");
		projectDir = join(root, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		const models = [{ id: "fake-model", contextWindow: 200000, maxTokens: 8192 }];
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					fake: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "fake", models },
				},
			}),
		);
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ lastChangelogVersion: "9999.0.0", defaultProvider: "fake", defaultModel: "fake-model" }),
		);
		writeFileSync(join(agentDir, "auth.json"), "{}");
	});

	afterEach(async () => {
		await Promise.all(clients.splice(0).map((client) => client.stop()));
	});

	afterAll(() => {
		server?.close();
		rmSync(root, { recursive: true, force: true });
	});

	it("initializes with Pi's capabilities", async () => {
		const { init } = await startClient();
		expect(init.protocolVersion).toBe(1);
		expect(init.agentCapabilities).toMatchObject({
			loadSession: true,
			promptCapabilities: { image: true, embeddedContext: true },
			mcpCapabilities: { http: true },
			sessionCapabilities: { list: {}, resume: {}, close: {} },
		});
		expect(init.authMethods).toEqual([]);
	});

	it("runs a prompt: text, tool calls with diffs and output, and the stop reason", async () => {
		const { client } = await startClient();
		const { sessionId, configOptions } = await client.request("session/new", { cwd: projectDir, mcpServers: [] });
		expect(typeof sessionId).toBe("string");
		expect(configOptions.find((option: any) => option.id === "model")).toMatchObject({
			category: "model",
			currentValue: "fake/fake-model",
		});
		await client.waitFor(() => client.updatesOf("available_commands_update").length > 0);
		const commands = client.updatesOf("available_commands_update")[0].availableCommands.map((c: any) => c.name);
		expect(commands).toContain("compact");

		const result = await client.request("session/prompt", {
			sessionId,
			prompt: [{ type: "text", text: "[tools] please work" }],
		});
		expect(result).toEqual({ stopReason: "end_turn" });

		const text = client
			.updatesOf("agent_message_chunk")
			.map((u) => u.content.text)
			.join("");
		expect(text).toContain("Writing.");
		expect(text).toContain("All done.");

		const calls = client.updatesOf("tool_call");
		expect(calls.map((c) => [c.name, c.kind, c.status])).toEqual([
			["write", "edit", "in_progress"],
			["edit", "edit", "in_progress"],
			["bash", "execute", "in_progress"],
		]);
		const notesPath = join(projectDir, "notes.txt");
		expect(calls[0].locations).toEqual([{ path: notesPath }]);
		expect(calls[2].title).toBe("echo from-bash");

		const done = client.updatesOf("tool_call_update").filter((u) => u.status);
		expect(done.map((u) => u.status)).toEqual(["completed", "completed", "completed"]);
		expect(done[0].content).toEqual([{ type: "diff", path: notesPath, oldText: null, newText: "alpha\nbeta\n" }]);
		expect(done[1].content).toEqual([
			{ type: "diff", path: notesPath, oldText: "alpha\nbeta\n", newText: "alpha\ngamma\n" },
		]);
		expect(done[2].content[0].content.text).toContain("from-bash");
		expect(done[2].content[0].content.text.startsWith("```")).toBe(true);
		expect(readFileSync(notesPath, "utf8")).toBe("alpha\ngamma\n");
		expect(client.updatesOf("usage_update").length).toBeGreaterThan(0);

		const listed = await client.request("session/list", { cwd: projectDir });
		expect(listed.sessions.map((s: any) => s.sessionId)).toContain(sessionId);
	});

	it("cancels a running prompt", async () => {
		const { client } = await startClient();
		const { sessionId } = await client.request("session/new", { cwd: projectDir, mcpServers: [] });
		const prompt = client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "[slow] wait" }] });
		await new Promise((r) => setTimeout(r, 500));
		client.notify("session/cancel", { sessionId });
		expect(await prompt).toEqual({ stopReason: "cancelled" });
	});

	it("loads a session from an earlier process and replays it", async () => {
		const first = await startClient();
		const { sessionId } = await first.client.request("session/new", { cwd: projectDir, mcpServers: [] });
		await first.client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "[hello] hi there" }] });
		expect(await first.client.stop()).toBe(0);

		const { client } = await startClient();
		const loaded = await client.request("session/load", { sessionId, cwd: projectDir, mcpServers: [] });
		expect(loaded.configOptions.length).toBeGreaterThan(0);
		expect(client.updatesOf("user_message_chunk").map((u) => u.content.text)).toEqual(["[hello] hi there"]);
		expect(client.updatesOf("agent_message_chunk").map((u) => u.content.text)).toEqual([
			"Hello from the fake model.",
		]);

		const resumed = await startClient();
		await resumed.client.request("session/resume", { sessionId, cwd: projectDir, mcpServers: [] });
		await new Promise((r) => setTimeout(r, 100));
		expect(resumed.client.updatesOf("user_message_chunk")).toEqual([]);

		const missing = await client.call("session/load", { sessionId: "nope", cwd: projectDir, mcpServers: [] });
		expect(missing.error?.code).toBe(-32002);
	});

	it("asks the editor when an extension asks the user", async () => {
		const extensionPath = join(root, "ask-extension.ts");
		writeFileSync(
			extensionPath,
			`export default function (pi) {
	pi.registerCommand("ask", {
		description: "Ask a question",
		handler: async (_args, ctx) => {
			const ok = await ctx.ui.confirm("Proceed?", "Shall I go on?");
			const name = await ctx.ui.input("Your name");
			ctx.ui.notify("answer: " + ok + " " + name, "info");
		},
	});
}
`,
		);
		const { client } = await startClient(["-e", extensionPath]);
		client.onRequest = (message) =>
			message.method === "session/request_permission"
				? { outcome: { outcome: "selected", optionId: message.params.options[0].optionId } }
				: { action: "accept", content: { value: "Ada" } };
		const { sessionId } = await client.request("session/new", { cwd: projectDir, mcpServers: [] });
		await client.waitFor(() => client.updatesOf("available_commands_update").length > 0);
		expect(client.updatesOf("available_commands_update")[0].availableCommands.map((c: any) => c.name)).toContain(
			"ask",
		);
		expect(await client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "/ask" }] })).toEqual({
			stopReason: "end_turn",
		});
		expect(client.clientRequests.map((m) => m.method)).toEqual(["session/request_permission", "elicitation/create"]);
		expect(client.clientRequests[0].params.toolCall.title).toBe("Proceed?");
		expect(client.updatesOf("notice").map((u) => u.title)).toContain("answer: true Ada");
	});

	it("connects the MCP servers the editor passes, with their environment as given", async () => {
		const serverPath = join(root, "mcp-server.mjs");
		const marker = join(root, "mcp-marker.json");
		writeFileSync(
			serverPath,
			`import { writeFileSync } from "node:fs";
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\\n")) !== -1) {
		const message = JSON.parse(buffer.slice(0, index));
		buffer = buffer.slice(index + 1);
		if (message.id === undefined) continue;
		let result = {};
		if (message.method === "initialize") {
			writeFileSync(process.env.MARKER, JSON.stringify({ token: process.env.TOKEN }));
			result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "ide", version: "1" } };
		} else if (message.method === "tools/list") {
			result = { tools: [] };
		}
		process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
	}
});
`,
		);
		const { client } = await startClient();
		await client.request("session/new", {
			cwd: projectDir,
			mcpServers: [
				{
					name: "IDE tools",
					command: process.execPath,
					args: [serverPath],
					env: [
						{ name: "MARKER", value: marker },
						{ name: "TOKEN", value: EDITOR_TOKEN },
					],
				},
			],
		});
		await client.waitFor(() => {
			try {
				return JSON.parse(readFileSync(marker, "utf8")).token === EDITOR_TOKEN;
			} catch {
				return false;
			}
		});
	});

	it("changes the thinking level and model through config options", async () => {
		const { client } = await startClient();
		const { sessionId } = await client.request("session/new", { cwd: projectDir, mcpServers: [] });
		const result = await client.request("session/set_config_option", {
			sessionId,
			configId: "model",
			value: "fake/fake-model",
		});
		expect(result.configOptions.find((option: any) => option.id === "model").currentValue).toBe("fake/fake-model");
		const bad = await client.call("session/set_config_option", { sessionId, configId: "model", value: "x/y" });
		expect(bad.error?.code).toBe(-32602);
	});
});
