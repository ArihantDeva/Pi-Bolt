import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
	type Provider,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { preconnectOrigin } from "../../src/core/connection-warmer.ts";
import { createHarness, type Harness } from "./harness.ts";

const CATALOG_BASE_URL = "https://api.individual.githubcopilot.com";
const CREDENTIAL_BASE_URL = "https://api.enterprise.githubcopilot.com";

describe("ModelRuntime.lastRequestBaseUrl", () => {
	let harness: Harness | undefined;

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("is the base URL the auth resolved for the latest request, not the catalog's", async () => {
		harness = await createHarness();
		const catalogModel = { ...harness.getModel(), api: "openai-completions", baseUrl: CATALOG_BASE_URL };
		const respond = (requestModel: Model<string>) => {
			const stream = createAssistantMessageEventStream();
			stream.push({
				type: "done",
				reason: "stop",
				message: {
					...fauxAssistantMessage("ok"),
					api: requestModel.api,
					provider: requestModel.provider,
					model: requestModel.id,
				},
			});
			return stream;
		};
		const provider: Provider<string> = {
			id: catalogModel.provider,
			name: "Credential endpoint provider",
			baseUrl: CATALOG_BASE_URL,
			auth: {
				oauth: {
					name: "OAuth",
					login: async () => {
						throw new Error("unused");
					},
					refresh: async (credential) => credential,
					toAuth: async (credential) => ({ apiKey: credential.access, baseUrl: CREDENTIAL_BASE_URL }),
				},
			},
			getModels: () => [catalogModel],
			stream: (requestModel) => respond(requestModel),
			streamSimple: (requestModel) => respond(requestModel),
		};
		await harness.authStorage.modify(catalogModel.provider, async () => ({
			type: "oauth",
			access: "token",
			refresh: "refresh-token",
			expires: Date.now() + 60 * 60_000,
		}));
		const modelRuntime = harness.session.modelRuntime;
		modelRuntime.registerNativeProvider(provider);
		await modelRuntime.refresh({ allowNetwork: false, providers: [catalogModel.provider] });

		// Before any request it is unknown, and nothing is preconnected.
		expect(modelRuntime.lastRequestBaseUrl(catalogModel)).toBeUndefined();
		expect(preconnectOrigin(catalogModel, modelRuntime.lastRequestBaseUrl(catalogModel))).toBeUndefined();

		await modelRuntime.streamSimple(catalogModel, { messages: [] }).result();

		expect(modelRuntime.lastRequestBaseUrl(catalogModel)).toBe(CREDENTIAL_BASE_URL);
		expect(preconnectOrigin(catalogModel, modelRuntime.lastRequestBaseUrl(catalogModel))).toBe(CREDENTIAL_BASE_URL);
	});
});
