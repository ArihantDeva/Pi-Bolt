import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { CEREBRAS_MODEL_CATALOG } from "./cerebras.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function cerebrasProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "cerebras",
			name: "Cerebras",
			baseUrl: "https://api.cerebras.ai/v1",
			auth: { apiKey: envApiKeyAuth("Cerebras API key", ["CEREBRAS_API_KEY"]) },
			get models() {
				return Object.values(CEREBRAS_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		CEREBRAS_MODEL_CATALOG,
	);
}
