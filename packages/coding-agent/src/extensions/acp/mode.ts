/**
 * ACP mode (`--acp`): Pi as an Agent Client Protocol agent (https://agentclientprotocol.com), so editors that speak ACP
 * (Zed, JetBrains IDEs, VS Code and Neovim through their ACP clients) run Pi in their agent panel. The editor starts the
 * process and talks JSON-RPC over stdin and stdout.
 *
 * Every ACP session is a Pi session of its own, created as the other modes create theirs (the same runtime factory, so
 * settings, extensions, skills, prompt templates, MCP servers, and project trust apply as usual) in the directory the
 * editor names. Sessions are Pi's session files: `session/list` and `session/load` find the sessions of the terminal too,
 * and a session started in the editor resumes with `pi --session`. Pi runs its own tools; the editor sees each call with
 * its file locations, edits as diffs, and command output (in a terminal view, for editors that take one). Extension
 * dialogs reach the user as permission requests (confirm, select) and forms (input, editor), when the editor offers them.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Readable } from "node:stream";
import type { Api, Model } from "@earendil-works/pi-ai";
import { COMMAND_NAME, getDocsPath, PRODUCT_NAME, VERSION } from "../../config.ts";
import type { AgentSession } from "../../core/agent-session.ts";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
} from "../../core/agent-session-runtime.ts";
import { formatNoApiKeyFoundMessage } from "../../core/auth-guidance.ts";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "../../core/extensions/index.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { type SessionInfo as PiSessionInfo, SessionManager } from "../../core/session-manager.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { attachJsonlLineReader } from "../../modes/rpc/jsonl.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { AcpConnection, AcpError, errorText, isRecord } from "./connection.ts";
import { setSessionMcpServers } from "./extension.ts";
import {
	bashExitCode,
	bashOutputTail,
	bashResultContent,
	fenced,
	type OutputTail,
	promptToPi,
	replayMessages,
	resultText,
	runError,
	stopReasonOf,
	TERMINAL_START,
	type TerminalSent,
	terminalOutputDelta,
	toolCallInfo,
	toolPath,
	toolResultContent,
} from "./translate.ts";
import {
	ACP_PROTOCOL_VERSION,
	AcpErrorCode,
	type AvailableCommand,
	type ClientCapabilities,
	type ConfigOption,
	type ContentBlock,
	type CreateElicitationResponse,
	type InitializeResponse,
	type McpServer,
	type PermissionOption,
	type RequestPermissionResponse,
	type SessionInfo,
	type SessionUpdate,
	type StopReason,
	type ToolCallContent,
} from "./types.ts";

export { acpExtension } from "./extension.ts";

export interface AcpModeOptions {
	/** The runtime factory of main.ts, which builds each session as the other modes build theirs. */
	createRuntime: CreateAgentSessionRuntimeFactory;
	agentDir: string;
	/** Session directory from `--session-dir` or the environment; otherwise each directory's setting or default. */
	sessionDir?: string;
	/** `--offline`: no model catalog refresh. */
	offline?: boolean;
}

/** Files larger than this get no diff (an editor would not show it well, and reading it costs). */
const MAX_DIFF_BYTES = 1024 * 1024;
/** Live command output sent while a command runs: the end of it, at most this many characters, every 250 ms. */
const MAX_LIVE_OUTPUT_CHARS = 64 * 1024;
const LIVE_OUTPUT_INTERVAL_MS = 250;
const SESSION_LIST_PAGE_SIZE = 50;

/** Built-in commands ACP mode runs itself; Pi's other built-in commands need its terminal UI. */
const ACP_COMMANDS: AvailableCommand[] = [
	{
		name: "compact",
		description: "Compact the conversation",
		input: { hint: "optional instructions for the summary" },
	},
	{ name: "name", description: "Name this session", input: { hint: "session name" } },
];

/** Runs ACP on stdin and stdout until the editor closes them. */
export async function runAcpMode(options: AcpModeOptions): Promise<never> {
	takeOverStdout();
	const agent = new AcpAgent(options, (line) => writeRawStdout(line));
	let shuttingDown = false;
	const shutdown = async (exitCode: number, flush: boolean) => {
		if (shuttingDown) process.exit(exitCode);
		shuttingDown = true;
		detach();
		process.stdin.pause();
		await agent.dispose();
		if (flush) await flushRawStdout();
		process.exit(exitCode);
	};
	const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
	for (const signal of signals) {
		process.on(signal, () => {
			killTrackedDetachedChildren();
			void shutdown(signal === "SIGHUP" ? 129 : 143, false);
		});
	}
	const detach = agent.attach(process.stdin, () => void shutdown(0, true));
	return new Promise<never>(() => {});
}

/** The agent side of one ACP connection. Exported for tests, which drive it without stdio. */
export class AcpAgent {
	readonly connection: AcpConnection;
	private readonly options: AcpModeOptions;
	private readonly sessions = new Map<string, AcpSession>();
	private clientCapabilities: ClientCapabilities = {};
	/** Session creation runs one at a time: extensions load and project trust is decided per session. */
	private creating: Promise<unknown> = Promise.resolve();
	private refreshedModels = false;

	constructor(options: AcpModeOptions, write: (line: string) => void) {
		this.options = options;
		this.connection = new AcpConnection({
			write,
			onRequest: (method, params) => this.handleRequest(method, params),
			onNotification: (method, params) => this.handleNotification(method, params),
		});
	}

	/** Reads the client's messages from `input`; `onEnd` runs when it closes. Returns a function that stops reading. */
	attach(input: Readable, onEnd: () => void): () => void {
		const detachLines = attachJsonlLineReader(input, (line) => this.connection.receive(line));
		input.on("end", onEnd);
		return () => {
			detachLines();
			input.off("end", onEnd);
		};
	}

	get capabilities(): ClientCapabilities {
		return this.clientCapabilities;
	}

	async dispose(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.allSettled(sessions.map((session) => session.dispose()));
		this.connection.close();
	}

	sendUpdate(sessionId: string, update: SessionUpdate): void {
		this.connection.notify("session/update", { sessionId, update });
	}

	private async handleRequest(method: string, raw: unknown): Promise<unknown> {
		const params = isRecord(raw) ? raw : {};
		switch (method) {
			case "initialize":
				return this.initialize(params);
			case "authenticate":
				// No authentication methods are advertised: Pi uses its own credentials (`/login`, API keys).
				return {};
			case "session/new":
				return this.newSession(params);
			case "session/load":
				return this.loadSession(params, true);
			case "session/resume":
				return this.loadSession(params, false);
			case "session/list":
				return this.listSessions(params);
			case "session/close": {
				const session = this.session(params);
				this.sessions.delete(session.id);
				await session.dispose();
				return {};
			}
			case "session/prompt":
				return this.session(params).prompt(Array.isArray(params.prompt) ? (params.prompt as ContentBlock[]) : []);
			case "session/set_config_option":
				return {
					configOptions: await this.session(params).setConfigOption(
						requireString(params, "configId"),
						params.value,
					),
				};
			default:
				throw new AcpError(AcpErrorCode.MethodNotFound, `Method not found: ${method}`);
		}
	}

	private handleNotification(method: string, raw: unknown): void {
		if (method === "session/cancel" && isRecord(raw) && typeof raw.sessionId === "string") {
			this.sessions.get(raw.sessionId)?.cancel();
		}
	}

	private initialize(params: Record<string, unknown>): InitializeResponse {
		this.clientCapabilities = isRecord(params.clientCapabilities)
			? (params.clientCapabilities as ClientCapabilities)
			: {};
		return {
			protocolVersion: ACP_PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: true,
				promptCapabilities: { image: true, audio: false, embeddedContext: true },
				mcpCapabilities: { http: true, sse: false },
				sessionCapabilities: { list: {}, resume: {}, close: {} },
			},
			agentInfo: { name: COMMAND_NAME, title: PRODUCT_NAME, version: VERSION },
			authMethods: [],
		};
	}

	private session(params: Record<string, unknown>): AcpSession {
		const id = requireString(params, "sessionId");
		const session = this.sessions.get(id);
		if (!session) throw new AcpError(AcpErrorCode.ResourceNotFound, `Session not found: ${id}`);
		return session;
	}

	/** Session directory for sessions in `cwd`: `--session-dir`, else the user's `sessionDir` setting, else Pi's default. */
	private sessionDirFor(cwd: string): string | undefined {
		return (
			this.options.sessionDir ??
			SettingsManager.create(cwd, this.options.agentDir, { projectTrusted: false }).getSessionDir()
		);
	}

	private async newSession(params: Record<string, unknown>) {
		const cwd = requireDirectory(params);
		const sessionManager = SessionManager.create(cwd, this.sessionDirFor(cwd));
		const session = await this.open(sessionManager, mcpServersOf(params), false);
		return { sessionId: session.id, configOptions: session.configOptions() };
	}

	private async loadSession(params: Record<string, unknown>, replay: boolean) {
		const id = requireString(params, "sessionId");
		const cwd = requireDirectory(params);
		const open = this.sessions.get(id);
		if (open) {
			if (replay) open.replay();
			return { configOptions: open.configOptions() };
		}
		const sessionDir = this.sessionDirFor(cwd);
		const path = SessionManager.findById(cwd, id, sessionDir) ?? (await findSessionFile(id, this.options.sessionDir));
		if (!path) throw new AcpError(AcpErrorCode.ResourceNotFound, `Session not found: ${id}`);
		const session = await this.open(SessionManager.open(path, sessionDir, cwd), mcpServersOf(params), true);
		if (replay) session.replay();
		return { configOptions: session.configOptions() };
	}

	private async listSessions(params: Record<string, unknown>) {
		const cwd = typeof params.cwd === "string" && params.cwd !== "" ? params.cwd : undefined;
		// (Sessions of old Pi versions have no directory, which ACP requires.)
		const all = (
			cwd
				? await SessionManager.list(cwd, this.sessionDirFor(cwd))
				: await SessionManager.listAll(this.options.sessionDir)
		).filter((info) => info.cwd !== "");
		let start = 0;
		if (typeof params.cursor === "string" && params.cursor !== "") {
			start = Number.parseInt(params.cursor, 10);
			if (!Number.isSafeInteger(start) || start < 0)
				throw new AcpError(AcpErrorCode.InvalidParams, "Invalid cursor");
		}
		const page = all.slice(start, start + SESSION_LIST_PAGE_SIZE);
		const next = start + page.length;
		return {
			sessions: page.map(sessionInfo),
			...(next < all.length ? { nextCursor: String(next) } : {}),
		};
	}

	private async open(sessionManager: SessionManager, mcpServers: McpServer[], resumed: boolean): Promise<AcpSession> {
		const create = this.creating.then(async () => {
			const id = sessionManager.getSessionId();
			setSessionMcpServers(id, mcpServers);
			const runtime = await createAgentSessionRuntime(this.options.createRuntime, {
				cwd: sessionManager.getCwd(),
				agentDir: this.options.agentDir,
				sessionManager,
				sessionStartEvent: resumed ? { type: "session_start", reason: "resume" } : undefined,
			});
			for (const diagnostic of runtime.diagnostics) {
				console.error(`${diagnostic.type === "error" ? "Error" : "Warning"}: ${diagnostic.message}`);
			}
			// As the other modes exit on them: a session whose extension failed to load, or whose `--provider` is unknown
			// (it would run on another model), is not the session asked for.
			const errors = runtime.diagnostics.filter((diagnostic) => diagnostic.type === "error");
			if (errors.length > 0) {
				setSessionMcpServers(id, undefined);
				await runtime.dispose();
				throw new AcpError(AcpErrorCode.InternalError, errors.map((error) => error.message).join("\n"));
			}
			const session = new AcpSession(this, id, runtime);
			this.sessions.set(id, session);
			await session.bind();
			if (!this.refreshedModels && !this.options.offline) {
				this.refreshedModels = true;
				void runtime.services.modelRuntime.refresh({ signal: AbortSignal.timeout(15_000) }).catch(() => {});
			}
			// After the response that tells the client the session exists.
			setTimeout(() => session.announce(), 0);
			return session;
		});
		this.creating = create.catch(() => {});
		return create;
	}
}

/** One ACP session: a Pi session runtime and the translation of its events. */
class AcpSession {
	readonly id: string;
	private readonly agent: AcpAgent;
	private readonly runtime: AgentSessionRuntime;
	private unsubscribe?: () => void;
	private unsubscribeBackpressure?: () => void;
	/** Prompts of this session, one after the other. */
	private queue: Promise<unknown> = Promise.resolve();
	private cancelled = false;
	private messageCount = 0;
	private messageId: string | undefined;
	/** File contents before an edit or write, for its diff. */
	private readonly before = new Map<string, { path: string; text: string | null }>();
	private readonly runningTools = new Map<string, { name: string; args: unknown }>();
	/** Output of running commands: the end of it for a text view, or the latest report for a terminal. */
	private readonly liveOutput = new Map<
		string,
		{ timer?: ReturnType<typeof setTimeout>; text?: string; tail?: OutputTail }
	>();
	/** Commands shown in a terminal view, with what each terminal has been sent. */
	private readonly terminals = new Map<string, TerminalSent>();
	private disposed = false;

	constructor(agent: AcpAgent, id: string, runtime: AgentSessionRuntime) {
		this.agent = agent;
		this.id = id;
		this.runtime = runtime;
	}

	private get session(): AgentSession {
		return this.runtime.session;
	}

	private get cwd(): string {
		return this.runtime.cwd;
	}

	private send(update: SessionUpdate): void {
		if (!this.disposed) this.agent.sendUpdate(this.id, update);
	}

	async bind(): Promise<void> {
		this.runtime.setRebindSession(async () => {
			await this.rebind();
			this.announce();
		});
		await this.rebind();
	}

	private async rebind(): Promise<void> {
		const session = this.session;
		await session.bindExtensions({
			uiContext: this.createUIContext(),
			// Extensions see a headless host whose dialogs a client answers, as in RPC mode.
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => this.session.waitForIdle(),
				newSession: async (options) => this.runtime.newSession(options),
				fork: async (entryId, forkOptions) => {
					const result = await this.runtime.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await this.session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => this.runtime.switchSession(sessionPath, options),
				reload: async () => {
					await this.session.reload();
					this.announce();
				},
			},
			onError: (err) => console.error(`Extension error (${err.extensionPath}): ${err.error}`),
		});
		this.unsubscribe?.();
		this.unsubscribeBackpressure?.();
		this.unsubscribe = session.subscribe((event) => this.onEvent(event));
		this.unsubscribeBackpressure = session.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
	}

	/** Sends what the editor shows next to the session: its commands, settings, title, and context use. */
	announce(): void {
		this.send({ sessionUpdate: "available_commands_update", availableCommands: this.availableCommands() });
		this.send({ sessionUpdate: "config_option_update", configOptions: this.configOptions() });
		const title = this.session.sessionName;
		if (title) this.send({ sessionUpdate: "session_info_update", title });
		this.sendUsage();
	}

	replay(): void {
		for (const update of replayMessages(this.session.messages, this.cwd)) this.send(update);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const live of this.liveOutput.values()) clearTimeout(live.timer);
		this.unsubscribe?.();
		this.unsubscribeBackpressure?.();
		await this.runtime.dispose();
		setSessionMcpServers(this.id, undefined);
	}

	cancel(): void {
		this.cancelled = true;
		void this.session.abort();
	}

	prompt(blocks: ContentBlock[]): Promise<{ stopReason: StopReason }> {
		const run = this.queue.then(() => this.runPrompt(blocks));
		this.queue = run.catch(() => {});
		return run;
	}

	private async runPrompt(blocks: ContentBlock[]): Promise<{ stopReason: StopReason }> {
		this.cancelled = false;
		const { text, images } = promptToPi(blocks);
		const command = /^\/(compact|name)(?:\s+([\s\S]*))?$/.exec(text.trim());
		if (command && images.length === 0) {
			await this.runCommand(command[1], command[2]?.trim() ?? "");
			return { stopReason: this.cancelled ? "cancelled" : "end_turn" };
		}
		const session = this.session;
		if (!session.model) {
			throw new AcpError(AcpErrorCode.InternalError, `No models available. ${setupHelp()}`);
		}
		const start = session.messages.length;
		try {
			await session.prompt(text, { images: images.length > 0 ? images : undefined, source: "rpc" });
			await session.waitForIdle();
		} catch (error) {
			if (this.cancelled) return { stopReason: "cancelled" };
			// Pi's own message points to /login, which the editor does not have. (Not AuthRequired: Zed shows its own
			// message for that, and ACP mode has no authentication methods to offer.)
			const provider = session.model?.provider;
			if (provider && errorText(error) === formatNoApiKeyFoundMessage(provider)) {
				// (A provider of "unknown" is the placeholder model of a Pi with nothing set up.)
				const problem = provider === "unknown" ? "No model is set up." : `No API key found for ${provider}.`;
				throw new AcpError(AcpErrorCode.InternalError, `${problem} ${setupHelp()}`);
			}
			throw error;
		} finally {
			this.sendUsage();
		}
		const messages = session.messages.slice(start);
		const error = this.cancelled ? undefined : runError(messages);
		if (error) throw new AcpError(AcpErrorCode.InternalError, error);
		return { stopReason: stopReasonOf(messages, this.cancelled) };
	}

	private async runCommand(name: string, argument: string): Promise<void> {
		const reply = (text: string) =>
			this.send({ sessionUpdate: "agent_message_chunk", messageId: randomUUID(), content: { type: "text", text } });
		if (name === "name") {
			if (!argument) {
				reply(this.session.sessionName ? `Session name: ${this.session.sessionName}` : "Usage: /name <name>");
				return;
			}
			this.session.setSessionName(argument);
			reply(`Session named "${argument}".`);
			return;
		}
		try {
			const result = await this.session.compact(argument || undefined);
			reply(`Compacted the conversation (${result.tokensBefore.toLocaleString("en-US")} tokens before).`);
		} catch (error) {
			if (this.cancelled) return;
			throw new AcpError(AcpErrorCode.InternalError, errorText(error));
		} finally {
			this.sendUsage();
		}
	}

	private sendUsage(): void {
		const usage = this.session.getContextUsage();
		if (!usage || usage.tokens === null) return;
		const cost = this.session.getSessionStats().cost;
		this.send({
			sessionUpdate: "usage_update",
			used: usage.tokens,
			size: usage.contextWindow,
			...(cost > 0 ? { cost: { amount: cost, currency: "USD" } } : {}),
		});
	}

	private availableCommands(): AvailableCommand[] {
		const commands = new Map<string, AvailableCommand>();
		const add = (name: string, description: string | undefined, hint?: string) => {
			if (!commands.has(name))
				commands.set(name, { name, description: description || name, input: hint ? { hint } : null });
		};
		for (const command of this.session.extensionRunner.getRegisteredCommands()) {
			add(command.invocationName, command.description);
		}
		for (const template of this.session.promptTemplates)
			add(template.name, template.description, template.argumentHint);
		for (const skill of this.session.resourceLoader.getSkills().skills) add(`skill:${skill.name}`, skill.description);
		for (const command of ACP_COMMANDS) if (!commands.has(command.name)) commands.set(command.name, command);
		return [...commands.values()];
	}

	/** The models to choose from: those of `--models` or the `enabledModels` setting, as in the terminal, else all. */
	private selectableModels(): readonly Model<Api>[] {
		const scoped = this.session.scopedModels;
		return scoped.length > 0 ? scoped.map((entry) => entry.model) : this.session.modelRuntime.getAvailableSnapshot();
	}

	configOptions(): ConfigOption[] {
		const options: ConfigOption[] = [];
		const session = this.session;
		const models = this.selectableModels();
		const current = session.model;
		if (models.length > 0 && current) {
			const choices = models.map((model) => ({
				value: modelKey(model),
				name: model.name || model.id,
				description: model.provider,
			}));
			if (!models.some((model) => modelKey(model) === modelKey(current))) {
				choices.unshift({
					value: modelKey(current),
					name: current.name || current.id,
					description: current.provider,
				});
			}
			options.push({
				id: "model",
				name: "Model",
				category: "model",
				type: "select",
				currentValue: modelKey(current),
				options: choices,
			});
		}
		const levels = session.getAvailableThinkingLevels();
		if (levels.length > 1) {
			options.push({
				id: "thinking",
				name: "Thinking",
				category: "thought_level",
				type: "select",
				currentValue: session.thinkingLevel,
				options: levels.map((level) => ({ value: level, name: level })),
			});
		}
		return options;
	}

	async setConfigOption(configId: string, value: unknown): Promise<ConfigOption[]> {
		if (typeof value !== "string") throw new AcpError(AcpErrorCode.InvalidParams, "value must be a string");
		const session = this.session;
		if (configId === "model") {
			const model = this.selectableModels().find((candidate) => modelKey(candidate) === value);
			if (!model) throw new AcpError(AcpErrorCode.InvalidParams, `Unknown model: ${value}`);
			await session.setModel(model);
		} else if (configId === "thinking") {
			const level = session.getAvailableThinkingLevels().find((candidate) => candidate === value);
			if (!level) throw new AcpError(AcpErrorCode.InvalidParams, `Unknown thinking level: ${value}`);
			session.setThinkingLevel(level);
		} else {
			throw new AcpError(AcpErrorCode.InvalidParams, `Unknown config option: ${configId}`);
		}
		this.sendUsage();
		return this.configOptions();
	}

	// =========================================================================
	// Events
	// =========================================================================

	private onEvent(event: Parameters<Parameters<AgentSession["subscribe"]>[0]>[0]): void {
		switch (event.type) {
			case "message_start":
				if (event.message.role === "assistant") this.messageId = `msg_${randomUUID()}`;
				break;
			case "message_update": {
				const update = event.assistantMessageEvent;
				const messageId = this.messageId ?? `msg_${this.messageCount++}`;
				if (update.type === "text_delta" && update.delta) {
					this.send({
						sessionUpdate: "agent_message_chunk",
						messageId,
						content: { type: "text", text: update.delta },
					});
				} else if (update.type === "thinking_delta" && update.delta) {
					this.send({
						sessionUpdate: "agent_thought_chunk",
						messageId,
						content: { type: "text", text: update.delta },
					});
				}
				break;
			}
			case "tool_execution_start": {
				if (event.parentToolCallId) break;
				this.runningTools.set(event.toolCallId, { name: event.toolName, args: event.args });
				if (event.toolName === "edit" || event.toolName === "write") this.snapshot(event.toolCallId, event.args);
				const info = toolCallInfo(event.toolName, event.args, this.cwd);
				// Zed's extension: the command's output in a terminal view, which updates append to.
				const terminal = event.toolName === "bash" && this.agent.capabilities._meta?.terminal_output === true;
				if (terminal) this.terminals.set(event.toolCallId, TERMINAL_START);
				this.send({
					sessionUpdate: "tool_call",
					toolCallId: event.toolCallId,
					name: event.toolName,
					title: info.title,
					kind: info.kind,
					status: "in_progress",
					locations: info.locations,
					rawInput: event.args,
					...(terminal
						? {
								content: [terminalContent(event.toolCallId)],
								_meta: { terminal_info: { terminal_id: event.toolCallId, cwd: this.cwd } },
							}
						: {}),
				});
				break;
			}
			case "tool_execution_update":
				if (!event.parentToolCallId && event.toolName === "bash")
					this.liveBashOutput(event.toolCallId, event.partialResult);
				break;
			case "tool_execution_end": {
				if (event.parentToolCallId) break;
				this.runningTools.delete(event.toolCallId);
				const live = this.liveOutput.get(event.toolCallId);
				if (live) clearTimeout(live.timer);
				if (this.terminals.has(event.toolCallId)) {
					this.endTerminal(event.toolCallId, event.result, event.isError);
					break;
				}
				this.liveOutput.delete(event.toolCallId);
				this.send({
					sessionUpdate: "tool_call_update",
					toolCallId: event.toolCallId,
					status: event.isError ? "failed" : "completed",
					content: this.resultContent(event.toolCallId, event.toolName, event.result, event.isError),
				});
				break;
			}
			case "session_info_changed":
				this.send({ sessionUpdate: "session_info_update", title: event.name ?? null });
				break;
			case "thinking_level_changed":
				this.send({ sessionUpdate: "config_option_update", configOptions: this.configOptions() });
				break;
			case "compaction_end":
				this.sendUsage();
				break;
			case "auto_retry_start":
				this.notice("warning", `Retrying (${event.attempt}/${event.maxAttempts})`, event.errorMessage);
				break;
			default:
				break;
		}
	}

	private notice(severity: "info" | "warning" | "error", title: string, description?: string): void {
		if (this.agent.capabilities.session?.notices) {
			this.send({ sessionUpdate: "notice", severity, title, ...(description ? { description } : {}) });
		} else {
			console.error(description ? `${title}: ${description}` : title);
		}
	}

	private snapshot(toolCallId: string, args: unknown): void {
		const path = toolPath(args, this.cwd);
		if (!path) return;
		try {
			if (!existsSync(path)) {
				this.before.set(toolCallId, { path, text: null });
			} else if (statSync(path).size <= MAX_DIFF_BYTES) {
				this.before.set(toolCallId, { path, text: readFileSync(path, "utf8") });
			}
		} catch {
			// No diff for files that cannot be read.
		}
	}

	private resultContent(toolCallId: string, toolName: string, result: unknown, isError: boolean): ToolCallContent[] {
		const before = this.before.get(toolCallId);
		this.before.delete(toolCallId);
		if (before && !isError) {
			try {
				if (statSync(before.path).size <= MAX_DIFF_BYTES) {
					const after = readFileSync(before.path, "utf8");
					if (after !== before.text)
						return [{ type: "diff", path: before.path, oldText: before.text, newText: after }];
				}
			} catch {
				// Fall back to the tool's own result.
			}
		}
		return toolName === "bash" ? bashResultContent(result) : toolResultContent(result);
	}

	private liveBashOutput(toolCallId: string, partialResult: unknown): void {
		let live = this.liveOutput.get(toolCallId);
		if (!live) {
			live = {};
			this.liveOutput.set(toolCallId, live);
		}
		if (this.terminals.has(toolCallId)) {
			live.tail = bashOutputTail(partialResult);
		} else {
			const text = resultText(partialResult);
			live.text = text.length > MAX_LIVE_OUTPUT_CHARS ? `…${text.slice(-MAX_LIVE_OUTPUT_CHARS)}` : text;
		}
		if (live.timer) return;
		live.timer = setTimeout(() => {
			const current = this.liveOutput.get(toolCallId);
			if (!current) return;
			current.timer = undefined;
			if (this.terminals.has(toolCallId)) {
				this.sendTerminalOutput(toolCallId);
				return;
			}
			this.send({
				sessionUpdate: "tool_call_update",
				toolCallId,
				// (Some clients take an update without a status for a finished call.)
				status: "in_progress",
				content: current.text ? [textContent(fenced(current.text))] : [],
			});
		}, LIVE_OUTPUT_INTERVAL_MS);
	}

	/**
	 * Sends a terminal the output it has not been sent yet, and a last line. Without content, which would replace the
	 * terminal.
	 */
	private sendTerminalOutput(toolCallId: string, lastLine?: string): void {
		let sent = this.terminals.get(toolCallId);
		if (!sent) return;
		let data = "";
		const tail = this.liveOutput.get(toolCallId)?.tail;
		if (tail) {
			const delta = terminalOutputDelta(sent, tail);
			sent = delta.sent;
			this.terminals.set(toolCallId, sent);
			data = delta.data;
		}
		if (lastLine) data += `${sent.end > 0 && !sent.text.endsWith("\n") ? "\n" : ""}${lastLine}\n`;
		if (data === "") return;
		this.send({
			sessionUpdate: "tool_call_update",
			toolCallId,
			status: "in_progress",
			_meta: { terminal_output: { terminal_id: toolCallId, data } },
		});
	}

	/** Ends a command's terminal: the rest of its output, why it stopped when it did not finish, and its exit code. */
	private endTerminal(toolCallId: string, result: unknown, isError: boolean): void {
		const exitCode = bashExitCode(result, isError);
		let reason: string | undefined;
		if (exitCode === null) {
			// Timed out, aborted, or blocked: the result's text says why, after the output if there was any.
			const text = resultText(result).trim();
			const hadOutput = (this.liveOutput.get(toolCallId)?.tail?.totalBytes ?? 0) > 0;
			reason = hadOutput ? text.slice(text.lastIndexOf("\n\n") + 1).trim() : text;
		}
		this.sendTerminalOutput(toolCallId, reason);
		this.liveOutput.delete(toolCallId);
		this.terminals.delete(toolCallId);
		this.send({
			sessionUpdate: "tool_call_update",
			toolCallId,
			status: isError ? "failed" : "completed",
			_meta: { terminal_exit: { terminal_id: toolCallId, exit_code: exitCode } },
		});
	}

	// =========================================================================
	// Extension UI
	// =========================================================================

	/** A permission request about the running tool call, or about a dialog of its own when no tool runs. */
	private async askPermission(
		title: string,
		message: string | undefined,
		options: PermissionOption[],
		opts: ExtensionUIDialogOptions | undefined,
	): Promise<string | undefined> {
		if (opts?.signal?.aborted) return undefined;
		const running = [...this.runningTools.keys()].at(-1);
		const toolCallId = running ?? `dialog_${randomUUID()}`;
		const content = message ? { content: [textContent(message)] } : {};
		const toolCall = running
			? { toolCallId, title, ...content }
			: { toolCallId, title, kind: "other" as const, status: "pending" as const, ...content };
		const request = this.agent.connection.request<RequestPermissionResponse>("session/request_permission", {
			sessionId: this.id,
			toolCall,
			options,
		});
		const response = await settleWithin(request, opts);
		const selected = response && response.outcome.outcome === "selected" ? response.outcome.optionId : undefined;
		// Clients keep what a permission request changes on the tool call: give a running tool its own title and output
		// back, and end a dialog's own entry.
		const tool = running ? this.runningTools.get(running) : undefined;
		if (tool) {
			const live = this.liveOutput.get(toolCallId)?.text;
			const output = this.terminals.has(toolCallId)
				? [terminalContent(toolCallId)]
				: live
					? [textContent(fenced(live))]
					: [];
			this.send({
				sessionUpdate: "tool_call_update",
				toolCallId,
				title: toolCallInfo(tool.name, tool.args, this.cwd).title,
				...(message ? { content: output } : {}),
			});
		} else if (!running) {
			this.send({
				sessionUpdate: "tool_call_update",
				toolCallId,
				status: selected === undefined ? "failed" : "completed",
			});
		}
		return selected;
	}

	private async askText(
		title: string,
		field: { description?: string; default?: string },
		opts: ExtensionUIDialogOptions | undefined,
	): Promise<string | undefined> {
		if (!this.agent.capabilities.elicitation?.form || opts?.signal?.aborted) return undefined;
		const running = [...this.runningTools.keys()].at(-1);
		const request = this.agent.connection.request<CreateElicitationResponse>("elicitation/create", {
			sessionId: this.id,
			...(running ? { toolCallId: running } : {}),
			mode: "form",
			message: title,
			requestedSchema: {
				type: "object",
				properties: { value: { type: "string", title, ...field } },
				required: ["value"],
			},
		});
		const response = await settleWithin(request, opts);
		const value = response?.action === "accept" ? response.content?.value : undefined;
		return typeof value === "string" ? value : undefined;
	}

	private createUIContext(): ExtensionUIContext {
		return {
			select: async (title, options, opts) => {
				const permissionOptions: PermissionOption[] = options.map((option, index) => ({
					optionId: String(index),
					name: option,
					kind: /^(no|cancel|reject|deny|decline|abort|skip)\b/i.test(option) ? "reject_once" : "allow_once",
				}));
				const selected = await this.askPermission(title, undefined, permissionOptions, opts);
				return selected === undefined ? undefined : options[Number(selected)];
			},
			confirm: async (title, message, opts) =>
				(await this.askPermission(
					title,
					message,
					[
						{ optionId: "yes", name: "Yes", kind: "allow_once" },
						{ optionId: "no", name: "No", kind: "reject_once" },
					],
					opts,
				)) === "yes",
			input: (title, placeholder, opts) =>
				this.askText(title, placeholder ? { description: placeholder } : {}, opts),
			editor: (title, prefill) => this.askText(title, prefill ? { default: prefill } : {}, undefined),
			notify: (message, type) => this.notice(type ?? "info", message),
			onTerminalInput: () => () => {},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined as never,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			get theme() {
				return theme;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Themes do not apply in ACP mode" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
	}
}

/** The client's answer, or undefined when the dialog's signal aborts or its timeout passes first. */
async function settleWithin<T>(
	request: Promise<T>,
	opts: ExtensionUIDialogOptions | undefined,
): Promise<T | undefined> {
	const guarded = request.catch(() => undefined);
	if (!opts?.signal && !opts?.timeout) return guarded;
	return new Promise<T | undefined>((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (value: T | undefined) => {
			clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			resolve(value);
		};
		const onAbort = () => finish(undefined);
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		if (opts.timeout) timer = setTimeout(() => finish(undefined), opts.timeout);
		void guarded.then(finish);
	});
}

function textContent(text: string): ToolCallContent {
	return { type: "content", content: { type: "text", text } };
}

/** A command's terminal, which has the tool call's id. */
function terminalContent(toolCallId: string): ToolCallContent {
	return { type: "terminal", terminalId: toolCallId };
}

/** How to set up a model, which ACP mode cannot do itself. */
function setupHelp(): string {
	return [
		`Run \`${COMMAND_NAME}\` in a terminal and use /login, or give the agent a provider's API key in its environment`,
		`(\`env\` in the editor's agent settings). See:\n  ${join(getDocsPath(), "providers.md")}`,
	].join(" ");
}

function modelKey(model: Pick<Model<Api>, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

function requireString(params: Record<string, unknown>, key: string): string {
	const value = params[key];
	if (typeof value !== "string" || value === "") throw new AcpError(AcpErrorCode.InvalidParams, `${key} is required`);
	return value;
}

/** The session's working directory, which must be an existing absolute path. */
function requireDirectory(params: Record<string, unknown>): string {
	const cwd = requireString(params, "cwd");
	let isDirectory = false;
	try {
		isDirectory = isAbsolute(cwd) && statSync(cwd).isDirectory();
	} catch {
		// Reported below.
	}
	if (!isDirectory)
		throw new AcpError(AcpErrorCode.InvalidParams, `cwd is not an absolute path of a directory: ${cwd}`);
	return cwd;
}

function mcpServersOf(params: Record<string, unknown>): McpServer[] {
	return Array.isArray(params.mcpServers) ? (params.mcpServers as unknown[]).filter(isMcpServer) : [];
}

function isMcpServer(value: unknown): value is McpServer {
	if (!isRecord(value) || typeof value.name !== "string") return false;
	if (value.type === "http" || value.type === "sse")
		return typeof value.url === "string" && Array.isArray(value.headers);
	return typeof value.command === "string" && Array.isArray(value.args);
}

function sessionInfo(info: PiSessionInfo): SessionInfo {
	const title = info.name || info.firstMessage.replace(/\s+/g, " ").trim().slice(0, 100) || null;
	return { sessionId: info.id, cwd: info.cwd, title, updatedAt: info.modified.toISOString() };
}

/** A session of any directory, for `session/load` of a session listed without a directory filter. */
async function findSessionFile(id: string, sessionDir: string | undefined): Promise<string | undefined> {
	return (await SessionManager.listAll(sessionDir)).find((info) => info.id === id)?.path;
}
