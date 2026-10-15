/**
 * The tools MCP mode offers (Model Context Protocol, https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
 * with the JSON schemas of their arguments and results.
 */

export interface McpTool {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
	annotations: {
		title: string;
		readOnlyHint: boolean;
		destructiveHint: boolean;
		idempotentHint: boolean;
		openWorldHint: boolean;
	};
}

export interface McpToolResult {
	content: { type: "text"; text: string }[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
}

export interface PromptArgs {
	prompt: string;
	cwd?: string;
	sessionId?: string;
	model?: string;
	thinking?: string;
}

export interface ListSessionsArgs {
	cwd?: string;
	limit?: number;
}

const usageSchema = {
	type: "object",
	description: "Tokens the model used for this prompt",
	properties: {
		inputTokens: { type: "integer" },
		outputTokens: { type: "integer" },
		cachedReadTokens: { type: "integer" },
		cachedWriteTokens: { type: "integer" },
		totalTokens: { type: "integer" },
		cost: { type: "number", description: "In US dollars, when the model has prices" },
	},
	required: ["inputTokens", "outputTokens", "totalTokens"],
};

export const PROMPT_TOOL: McpTool = {
	name: "prompt",
	title: "Run Pi",
	description: [
		"Gives a task to Pi, a coding agent, and returns its answer. Pi works in the directory `cwd` with its own tools",
		"(it reads and edits files and runs commands there) until the task is done. The result names the session: pass",
		"it as `sessionId` to continue the same conversation, with what Pi has learned so far.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			prompt: { type: "string", description: "The task or question for Pi" },
			cwd: {
				type: "string",
				description: "Absolute path of the directory Pi works in. Default: the server's working directory.",
			},
			sessionId: {
				type: "string",
				description: "Continue this session (from an earlier result or list_sessions) instead of starting one",
			},
			model: {
				type: "string",
				description: "Model to use from now on in this session, as provider/model (default: Pi's default model)",
			},
			thinking: {
				type: "string",
				enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
				description: "Thinking level to use from now on in this session",
			},
		},
		required: ["prompt"],
		additionalProperties: false,
	},
	outputSchema: {
		type: "object",
		properties: {
			sessionId: { type: "string", description: "The session, to continue it" },
			text: { type: "string", description: "Pi's answer: the text of its last message" },
			stopReason: { type: "string", enum: ["end_turn", "max_tokens", "cancelled", "error"] },
			usage: usageSchema,
		},
		required: ["sessionId", "text", "stopReason"],
	},
	annotations: {
		title: "Run Pi",
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
};

export const LIST_SESSIONS_TOOL: McpTool = {
	name: "list_sessions",
	title: "List Pi sessions",
	description: "Lists Pi's sessions in a directory, most recent first, to continue one with `prompt`.",
	inputSchema: {
		type: "object",
		properties: {
			cwd: {
				type: "string",
				description: "Absolute path of the directory. Default: the server's working directory.",
			},
			limit: { type: "integer", minimum: 1, maximum: 100, description: "At most this many (default 20)" },
		},
		additionalProperties: false,
	},
	outputSchema: {
		type: "object",
		properties: {
			sessions: {
				type: "array",
				items: {
					type: "object",
					properties: {
						sessionId: { type: "string" },
						cwd: { type: "string" },
						title: { type: "string" },
						updatedAt: { type: "string", description: "ISO 8601" },
					},
					required: ["sessionId", "cwd", "title", "updatedAt"],
				},
			},
		},
		required: ["sessions"],
	},
	annotations: {
		title: "List Pi sessions",
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
};

export const TOOLS: McpTool[] = [PROMPT_TOOL, LIST_SESSIONS_TOOL];

/** A failed tool call, which the calling model reads (MCP reports tool errors in the result, not as protocol errors). */
export function toolError(message: string): McpToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}
