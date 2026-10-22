import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { BASETEN_MODEL_CATALOG } from "./baseten.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function basetenProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "baseten",
			name: "Baseten",
			baseUrl: "https://inference.baseten.co/v1",
			auth: { apiKey: envApiKeyAuth("Baseten API key", ["BASETEN_API_KEY"]) },
			get models() {
				return Object.values(BASETEN_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		BASETEN_MODEL_CATALOG,
	);
}
