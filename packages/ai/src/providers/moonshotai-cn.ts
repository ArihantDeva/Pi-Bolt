import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { MOONSHOTAI_CN_MODEL_CATALOG } from "./moonshotai-cn.catalog.generated.ts";

export function moonshotaiCnProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "moonshotai-cn",
			name: "Moonshot AI CN",
			baseUrl: "https://api.moonshot.cn/v1",
			auth: { apiKey: envApiKeyAuth("Moonshot AI API key", ["MOONSHOT_API_KEY"]) },
			get models() {
				return Object.values(MOONSHOTAI_CN_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		MOONSHOTAI_CN_MODEL_CATALOG,
	);
}
