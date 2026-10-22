import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { MOONSHOTAI_MODEL_CATALOG } from "./moonshotai.catalog.ts";

export function moonshotaiProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "moonshotai",
			name: "Moonshot AI",
			baseUrl: "https://api.moonshot.ai/v1",
			auth: { apiKey: envApiKeyAuth("Moonshot AI API key", ["MOONSHOT_API_KEY"]) },
			get models() {
				return Object.values(MOONSHOTAI_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		MOONSHOTAI_MODEL_CATALOG,
	);
}
