import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { NVIDIA_MODEL_CATALOG } from "./nvidia.catalog.generated.ts";

export function nvidiaProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "nvidia",
			name: "NVIDIA",
			baseUrl: "https://integrate.api.nvidia.com/v1",
			auth: { apiKey: envApiKeyAuth("NVIDIA API key", ["NVIDIA_API_KEY"]) },
			get models() {
				return Object.values(NVIDIA_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		NVIDIA_MODEL_CATALOG,
	);
}
