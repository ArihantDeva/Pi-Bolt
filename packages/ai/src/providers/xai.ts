import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadXaiOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { XAI_MODEL_CATALOG } from "./xai.catalog.ts";

export function xaiProvider(): Provider<"openai-responses"> {
	return withCatalogListing(
		createProvider({
			id: "xai",
			name: "xAI",
			baseUrl: "https://api.x.ai/v1",
			auth: {
				apiKey: envApiKeyAuth("xAI API key", ["XAI_API_KEY"]),
				oauth: lazyOAuth({
					name: "xAI (Grok/X subscription)",
					isSubscription: true,
					loginLabel: "Sign in with SuperGrok or X Premium",
					load: loadXaiOAuth,
				}),
			},
			get models() {
				return Object.values(XAI_MODEL_CATALOG.chat());
			},
			api: openAIResponsesApi(),
		}),
		XAI_MODEL_CATALOG,
	);
}
