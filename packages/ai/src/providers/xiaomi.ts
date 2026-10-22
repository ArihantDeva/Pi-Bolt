import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { XIAOMI_MODEL_CATALOG } from "./xiaomi.catalog.ts";

export function xiaomiProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "xiaomi",
			name: "Xiaomi",
			baseUrl: "https://api.xiaomimimo.com/v1",
			auth: { apiKey: envApiKeyAuth("Xiaomi API key", ["XIAOMI_API_KEY"]) },
			get models() {
				return Object.values(XIAOMI_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		XIAOMI_MODEL_CATALOG,
	);
}
