import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { MINIMAX_MODEL_CATALOG } from "./minimax.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function minimaxProvider(): Provider<"anthropic-messages"> {
	return withCatalogListing(
		createProvider({
			id: "minimax",
			name: "MiniMax",
			baseUrl: "https://api.minimax.io/anthropic",
			auth: { apiKey: envApiKeyAuth("MiniMax API key", ["MINIMAX_API_KEY"]) },
			get models() {
				return Object.values(MINIMAX_MODEL_CATALOG.chat());
			},
			api: anthropicMessagesApi(),
		}),
		MINIMAX_MODEL_CATALOG,
	);
}
