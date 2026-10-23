import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { XIAOMI_TOKEN_PLAN_AMS_MODEL_CATALOG } from "./xiaomi-token-plan-ams.catalog.generated.ts";

export function xiaomiTokenPlanAmsProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "xiaomi-token-plan-ams",
			name: "Xiaomi Token Plan AMS",
			baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
			auth: { apiKey: envApiKeyAuth("Xiaomi Token Plan AMS API key", ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"]) },
			get models() {
				return Object.values(XIAOMI_TOKEN_PLAN_AMS_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		XIAOMI_TOKEN_PLAN_AMS_MODEL_CATALOG,
	);
}
