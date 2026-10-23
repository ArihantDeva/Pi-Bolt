import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { MINIMAX_CN_MODEL_CATALOG } from "./minimax-cn.catalog.generated.ts";
import { withCatalogListing } from "./model-listing.ts";

export function minimaxCnProvider(): Provider<"anthropic-messages"> {
	return withCatalogListing(
		createProvider({
			id: "minimax-cn",
			name: "MiniMax CN",
			baseUrl: "https://api.minimaxi.com/anthropic",
			auth: { apiKey: envApiKeyAuth("MiniMax CN API key", ["MINIMAX_CN_API_KEY"]) },
			get models() {
				return Object.values(MINIMAX_CN_MODEL_CATALOG.chat());
			},
			api: anthropicMessagesApi(),
		}),
		MINIMAX_CN_MODEL_CATALOG,
	);
}
