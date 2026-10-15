/**
 * The part of the Agent Client Protocol (version 1, https://agentclientprotocol.com/protocol/v1/schema) that the agent side
 * here sends and receives. Fields the agent ignores are left out; unknown fields from clients are tolerated.
 */

export const ACP_PROTOCOL_VERSION = 1;

/** JSON-RPC error codes ACP uses. */
export const AcpErrorCode = {
	ParseError: -32700,
	InvalidRequest: -32600,
	MethodNotFound: -32601,
	InvalidParams: -32602,
	InternalError: -32603,
	AuthRequired: -32000,
	ResourceNotFound: -32002,
} as const;

export interface Implementation {
	name: string;
	title?: string;
	version?: string;
}

export interface ClientCapabilities {
	fs?: { readTextFile?: boolean; writeTextFile?: boolean } | null;
	terminal?: boolean | null;
	elicitation?: { form?: object | null; url?: object | null } | null;
	session?: {
		notices?: object | null;
		compaction?: object | null;
		configOptions?: { boolean?: object | null } | null;
	} | null;
}

export interface InitializeRequest {
	protocolVersion: number;
	clientCapabilities?: ClientCapabilities;
	clientInfo?: Implementation;
}

export interface InitializeResponse {
	protocolVersion: number;
	agentCapabilities: {
		loadSession: boolean;
		promptCapabilities: { image: boolean; audio: boolean; embeddedContext: boolean };
		mcpCapabilities: { http: boolean; sse: boolean };
		sessionCapabilities: { list: object; resume: object; close: object };
	};
	agentInfo: Implementation;
	authMethods: AuthMethod[];
}

export interface AuthMethod {
	id: string;
	name: string;
	description?: string;
}

export interface EnvVariable {
	name: string;
	value: string;
}

export interface HttpHeader {
	name: string;
	value: string;
}

export type McpServer =
	| { type?: "stdio"; name: string; command: string; args: string[]; env?: EnvVariable[] }
	| { type: "http"; name: string; url: string; headers: HttpHeader[] }
	| { type: "sse"; name: string; url: string; headers: HttpHeader[] };

export interface NewSessionRequest {
	cwd: string;
	mcpServers?: McpServer[];
}

export interface LoadSessionRequest {
	sessionId: string;
	cwd: string;
	mcpServers?: McpServer[];
}

export interface ListSessionsRequest {
	cwd?: string | null;
	cursor?: string | null;
}

export interface SessionInfo {
	sessionId: string;
	cwd: string;
	title?: string | null;
	updatedAt?: string | null;
}

export interface Annotations {
	audience?: string[];
	priority?: number;
	lastModified?: string;
}

export type ContentBlock =
	| { type: "text"; text: string; annotations?: Annotations }
	| { type: "image"; data: string; mimeType: string; uri?: string | null; annotations?: Annotations }
	| { type: "audio"; data: string; mimeType: string; annotations?: Annotations }
	| {
			type: "resource_link";
			uri: string;
			name: string;
			title?: string | null;
			description?: string | null;
			mimeType?: string | null;
			size?: number | null;
			annotations?: Annotations;
	  }
	| {
			type: "resource";
			resource:
				| { uri: string; text: string; mimeType?: string | null }
				| { uri: string; blob: string; mimeType?: string | null };
			annotations?: Annotations;
	  };

export interface PromptRequest {
	sessionId: string;
	prompt: ContentBlock[];
}

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export type ToolKind =
	| "read"
	| "edit"
	| "delete"
	| "move"
	| "search"
	| "execute"
	| "think"
	| "fetch"
	| "switch_mode"
	| "other";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolCallContent =
	| { type: "content"; content: ContentBlock }
	| { type: "diff"; path: string; oldText?: string | null; newText: string }
	| { type: "terminal"; terminalId: string };

export interface ToolCallLocation {
	path: string;
	line?: number | null;
}

export interface ToolCallUpdateFields {
	toolCallId: string;
	name?: string;
	title?: string;
	kind?: ToolKind;
	status?: ToolCallStatus;
	content?: ToolCallContent[];
	locations?: ToolCallLocation[];
	rawInput?: unknown;
	rawOutput?: unknown;
}

export interface AvailableCommand {
	name: string;
	description: string;
	input?: { hint: string } | null;
}

export interface ConfigOptionValue {
	value: string;
	name: string;
	description?: string | null;
}

export interface ConfigOption {
	id: string;
	name: string;
	description?: string | null;
	category?: "mode" | "model" | "model_config" | "thought_level";
	type: "select";
	currentValue: string;
	options: ConfigOptionValue[];
}

export type SessionUpdate =
	| { sessionUpdate: "user_message_chunk"; content: ContentBlock; messageId?: string }
	| { sessionUpdate: "agent_message_chunk"; content: ContentBlock; messageId?: string }
	| { sessionUpdate: "agent_thought_chunk"; content: ContentBlock; messageId?: string }
	| ({ sessionUpdate: "tool_call"; title: string } & ToolCallUpdateFields)
	| ({ sessionUpdate: "tool_call_update" } & ToolCallUpdateFields)
	| { sessionUpdate: "available_commands_update"; availableCommands: AvailableCommand[] }
	| { sessionUpdate: "config_option_update"; configOptions: ConfigOption[] }
	| { sessionUpdate: "session_info_update"; title?: string | null; updatedAt?: string | null }
	| { sessionUpdate: "usage_update"; used: number; size: number; cost?: { amount: number; currency: string } | null }
	| { sessionUpdate: "notice"; severity: "info" | "warning" | "error"; title: string; description?: string | null };

export interface SessionNotification {
	sessionId: string;
	update: SessionUpdate;
}

export interface PermissionOption {
	optionId: string;
	name: string;
	kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface RequestPermissionRequest {
	sessionId: string;
	toolCall: ToolCallUpdateFields;
	options: PermissionOption[];
}

export interface RequestPermissionResponse {
	outcome: { outcome: "cancelled" } | { outcome: "selected"; optionId: string };
}

export interface CreateElicitationRequest {
	sessionId: string;
	mode: "form";
	message: string;
	requestedSchema: {
		type: "object";
		properties: Record<string, { type: "string"; title?: string; description?: string; default?: string }>;
		required?: string[];
	};
}

export interface CreateElicitationResponse {
	action: "accept" | "decline" | "cancel";
	content?: Record<string, unknown> | null;
}
