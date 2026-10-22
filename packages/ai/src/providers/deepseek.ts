import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { DEEPSEEK_MODEL_CATALOG } from "./deepseek.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function deepseekProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "deepseek",
			name: "DeepSeek",
			baseUrl: "https://api.deepseek.com",
			auth: { apiKey: envApiKeyAuth("DeepSeek API key", ["DEEPSEEK_API_KEY"]) },
			get models() {
				return Object.values(DEEPSEEK_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		DEEPSEEK_MODEL_CATALOG,
	);
}
