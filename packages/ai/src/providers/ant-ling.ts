import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { ANT_LING_MODEL_CATALOG } from "./ant-ling.catalog.generated.ts";
import { withCatalogListing } from "./model-listing.ts";

export function antLingProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "ant-ling",
			name: "Ant Ling",
			baseUrl: "https://api.ant-ling.com/v1",
			auth: { apiKey: envApiKeyAuth("Ant Ling API key", ["ANT_LING_API_KEY"]) },
			get models() {
				return Object.values(ANT_LING_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		ANT_LING_MODEL_CATALOG,
	);
}
