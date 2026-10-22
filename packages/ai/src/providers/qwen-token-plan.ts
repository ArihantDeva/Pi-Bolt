import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { QWEN_TOKEN_PLAN_MODEL_CATALOG } from "./qwen-token-plan.catalog.ts";

export function qwenTokenPlanProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "qwen-token-plan",
			name: "Qwen Token Plan",
			baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
			auth: { apiKey: envApiKeyAuth("Qwen Token Plan API key", ["QWEN_TOKEN_PLAN_API_KEY"]) },
			get models() {
				return Object.values(QWEN_TOKEN_PLAN_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		QWEN_TOKEN_PLAN_MODEL_CATALOG,
	);
}
