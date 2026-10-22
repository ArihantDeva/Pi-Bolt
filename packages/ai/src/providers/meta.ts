import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadMetaOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { META_MODEL_CATALOG } from "./meta.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function metaProvider(): Provider<"openai-responses"> {
	return withCatalogListing(
		createProvider({
			id: "meta",
			name: "Meta",
			baseUrl: "https://api.meta.ai/v1",
			auth: {
				apiKey: envApiKeyAuth("Meta Model API key", ["META_API_KEY"]),
				oauth: lazyOAuth({
					name: "Meta (Muse subscription)",
					isSubscription: true,
					loginLabel: "Sign in with Meta",
					load: loadMetaOAuth,
				}),
			},
			get models() {
				return Object.values(META_MODEL_CATALOG.chat());
			},
			api: openAIResponsesApi(),
		}),
		META_MODEL_CATALOG,
	);
}
