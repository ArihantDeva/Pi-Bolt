import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { XIAOMI_TOKEN_PLAN_SGP_MODEL_CATALOG } from "./xiaomi-token-plan-sgp.catalog.generated.ts";

export function xiaomiTokenPlanSgpProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "xiaomi-token-plan-sgp",
			name: "Xiaomi Token Plan SGP",
			baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
			auth: { apiKey: envApiKeyAuth("Xiaomi Token Plan SGP API key", ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"]) },
			get models() {
				return Object.values(XIAOMI_TOKEN_PLAN_SGP_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		XIAOMI_TOKEN_PLAN_SGP_MODEL_CATALOG,
	);
}
