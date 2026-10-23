import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { HUGGINGFACE_MODEL_CATALOG } from "./huggingface.catalog.generated.ts";
import { withCatalogListing } from "./model-listing.ts";

export function huggingfaceProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "huggingface",
			name: "Hugging Face",
			baseUrl: "https://router.huggingface.co/v1",
			auth: { apiKey: envApiKeyAuth("Hugging Face token", ["HF_TOKEN"]) },
			get models() {
				return Object.values(HUGGINGFACE_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		HUGGINGFACE_MODEL_CATALOG,
	);
}
