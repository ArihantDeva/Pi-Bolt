import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadKimiCodingOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { KIMI_CODING_MODEL_CATALOG } from "./kimi-coding.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function kimiCodingProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "kimi-coding",
			name: "Kimi For Coding",
			baseUrl: "https://api.kimi.com/coding/v1",
			auth: {
				apiKey: envApiKeyAuth("Kimi API key", ["KIMI_API_KEY"]),
				oauth: lazyOAuth({
					name: "Kimi Code (subscription)",
					isSubscription: true,
					loginLabel: "Sign in with Kimi Code",
					load: loadKimiCodingOAuth,
				}),
			},
			get models() {
				return Object.values(KIMI_CODING_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		KIMI_CODING_MODEL_CATALOG,
	);
}
