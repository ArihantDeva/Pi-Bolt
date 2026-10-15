/**
 * JSON-RPC 2.0 over newline-delimited JSON, both ways: ACP clients call the agent's methods, and the agent calls the
 * client's (permission requests, elicitation). Requests are served concurrently, so `session/cancel` and the other
 * methods are answered while a `session/prompt` is still running.
 */

import { AcpErrorCode } from "./types.ts";

type JsonRpcId = string | number;

/** Thrown by method handlers to answer with a specific JSON-RPC error. */
export class AcpError extends Error {
	readonly code: number;
	readonly data?: unknown;

	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.name = "AcpError";
		this.code = code;
		this.data = data;
	}
}

export type AcpRequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type AcpNotificationHandler = (method: string, params: unknown) => void;

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

export class AcpConnection {
	private readonly write: (line: string) => void;
	private readonly onRequest: AcpRequestHandler;
	private readonly onNotification: AcpNotificationHandler;
	private readonly pending = new Map<JsonRpcId, PendingRequest>();
	private nextId = 0;
	private closed = false;

	constructor(options: {
		write: (line: string) => void;
		onRequest: AcpRequestHandler;
		onNotification: AcpNotificationHandler;
	}) {
		this.write = options.write;
		this.onRequest = options.onRequest;
		this.onNotification = options.onNotification;
	}

	/** Handles one line received from the client. */
	receive(line: string): void {
		if (line.trim() === "") return;
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch (error) {
			this.send({ jsonrpc: "2.0", id: null, error: { code: AcpErrorCode.ParseError, message: errorText(error) } });
			return;
		}
		if (!isRecord(message)) {
			this.send({
				jsonrpc: "2.0",
				id: null,
				error: { code: AcpErrorCode.InvalidRequest, message: "Not a JSON-RPC message" },
			});
			return;
		}
		const id = message.id;
		const hasId = typeof id === "string" || typeof id === "number";
		if (typeof message.method === "string") {
			if (hasId) void this.serve(id, message.method, message.params);
			else this.notification(message.method, message.params);
			return;
		}
		if (hasId && ("result" in message || "error" in message)) {
			const request = this.pending.get(id);
			if (!request) return;
			this.pending.delete(id);
			if (isRecord(message.error)) {
				request.reject(
					new AcpError(
						typeof message.error.code === "number" ? message.error.code : AcpErrorCode.InternalError,
						typeof message.error.message === "string" ? message.error.message : "Client error",
						message.error.data,
					),
				);
			} else {
				request.resolve(message.result);
			}
		}
	}

	/** Calls a client method and waits for its result. */
	request<T>(method: string, params: unknown): Promise<T> {
		if (this.closed) return Promise.reject(new Error("The ACP connection is closed"));
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	notify(method: string, params: unknown): void {
		if (this.closed) return;
		this.send({ jsonrpc: "2.0", method, params });
	}

	/** Fails the requests still waiting for the client, which has gone. */
	close(): void {
		this.closed = true;
		for (const request of this.pending.values()) request.reject(new Error("The ACP connection is closed"));
		this.pending.clear();
	}

	private async serve(id: JsonRpcId, method: string, params: unknown): Promise<void> {
		try {
			const result = await this.onRequest(method, params);
			this.send({ jsonrpc: "2.0", id, result: result ?? null });
		} catch (error) {
			const code = error instanceof AcpError ? error.code : AcpErrorCode.InternalError;
			const data = error instanceof AcpError ? error.data : undefined;
			this.send({
				jsonrpc: "2.0",
				id,
				error: data === undefined ? { code, message: errorText(error) } : { code, message: errorText(error), data },
			});
		}
	}

	private notification(method: string, params: unknown): void {
		try {
			this.onNotification(method, params);
		} catch {
			// Notifications have no response to carry an error.
		}
	}

	private send(message: object): void {
		if (this.closed) return;
		this.write(`${JSON.stringify(message)}\n`);
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
