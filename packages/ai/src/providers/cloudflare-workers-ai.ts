import { cloudflareWorkersAISystemOneApi } from "../api/cloudflare-workers-ai-system-one.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { createProvider, type Provider } from "../models.ts";
import { cloudflareWorkersAIAuth } from "./cloudflare-auth.ts";
import { cloudflareClassifier, cloudflareStreams } from "./cloudflare-stream.ts";
import { CLOUDFLARE_WORKERS_AI_MODEL_CATALOG } from "./cloudflare-workers-ai.catalog.generated.ts";
import { withCatalogListing } from "./model-listing.ts";

export function cloudflareWorkersAIProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider<"openai-completions">({
			id: "cloudflare-workers-ai",
			name: "Cloudflare Workers AI",
			auth: { apiKey: cloudflareWorkersAIAuth() },
			get models() {
				return [
					...Object.values(CLOUDFLARE_WORKERS_AI_MODEL_CATALOG.chat()),
					...Object.values(CLOUDFLARE_WORKERS_AI_MODEL_CATALOG.classifier()),
				];
			},
			api: cloudflareStreams(openAICompletionsApi()),
			classifiers: {
				"cloudflare-workers-ai-system-one": cloudflareClassifier(cloudflareWorkersAISystemOneApi()),
			},
		}),
		CLOUDFLARE_WORKERS_AI_MODEL_CATALOG,
	);
}
