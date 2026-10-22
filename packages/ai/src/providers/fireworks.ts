import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { FIREWORKS_MODEL_CATALOG } from "./fireworks.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function fireworksProvider(): Provider<"anthropic-messages" | "openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "fireworks",
			name: "Fireworks",
			baseUrl: "https://api.fireworks.ai/inference",
			auth: { apiKey: envApiKeyAuth("Fireworks API key", ["FIREWORKS_API_KEY"]) },
			get models() {
				return Object.values(FIREWORKS_MODEL_CATALOG.chat());
			},
			api: {
				"anthropic-messages": anthropicMessagesApi(),
				"openai-completions": openAICompletionsApi(),
			},
		}),
		FIREWORKS_MODEL_CATALOG,
	);
}
