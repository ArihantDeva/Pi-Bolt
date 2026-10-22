import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { ZAI_CODING_CN_MODEL_CATALOG } from "./zai-coding-cn.catalog.ts";

export function zaiCodingCnProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "zai-coding-cn",
			name: "Z.AI Coding CN",
			baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
			auth: { apiKey: envApiKeyAuth("Z.AI Coding CN API key", ["ZAI_CODING_CN_API_KEY"]) },
			get models() {
				return Object.values(ZAI_CODING_CN_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		ZAI_CODING_CN_MODEL_CATALOG,
	);
}
