import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { XIAOMI_TOKEN_PLAN_CN_MODEL_CATALOG } from "./xiaomi-token-plan-cn.catalog.generated.ts";

export function xiaomiTokenPlanCnProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "xiaomi-token-plan-cn",
			name: "Xiaomi Token Plan CN",
			baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
			auth: { apiKey: envApiKeyAuth("Xiaomi Token Plan CN API key", ["XIAOMI_TOKEN_PLAN_CN_API_KEY"]) },
			get models() {
				return Object.values(XIAOMI_TOKEN_PLAN_CN_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		XIAOMI_TOKEN_PLAN_CN_MODEL_CATALOG,
	);
}
