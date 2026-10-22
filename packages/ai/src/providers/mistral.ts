import { mistralConversationsApi } from "../api/mistral-conversations.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { MISTRAL_MODEL_CATALOG } from "./mistral.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function mistralProvider(): Provider<"mistral-conversations"> {
	return withCatalogListing(
		createProvider({
			id: "mistral",
			name: "Mistral",
			baseUrl: "https://api.mistral.ai",
			auth: { apiKey: envApiKeyAuth("Mistral API key", ["MISTRAL_API_KEY"]) },
			get models() {
				return Object.values(MISTRAL_MODEL_CATALOG.chat());
			},
			api: mistralConversationsApi(),
		}),
		MISTRAL_MODEL_CATALOG,
	);
}
