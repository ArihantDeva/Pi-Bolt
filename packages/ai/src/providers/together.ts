import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { TOGETHER_MODEL_CATALOG } from "./together.catalog.generated.ts";

export function togetherProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "together",
			name: "Together",
			baseUrl: "https://api.together.ai/v1",
			auth: { apiKey: envApiKeyAuth("Together API key", ["TOGETHER_API_KEY"]) },
			get models() {
				return Object.values(TOGETHER_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		TOGETHER_MODEL_CATALOG,
	);
}
