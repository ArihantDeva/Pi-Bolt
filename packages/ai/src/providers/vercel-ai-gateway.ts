import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { typesafeSystemOneApi } from "../api/typesafe-system-one.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { VERCEL_AI_GATEWAY_MODEL_CATALOG } from "./vercel-ai-gateway.catalog.ts";

export function vercelAIGatewayProvider(): Provider<"anthropic-messages"> {
	return withCatalogListing(
		createProvider<"anthropic-messages">({
			id: "vercel-ai-gateway",
			name: "Vercel AI Gateway",
			baseUrl: "https://ai-gateway.vercel.sh",
			auth: { apiKey: envApiKeyAuth("Vercel AI Gateway API key", ["AI_GATEWAY_API_KEY"]) },
			get models() {
				return [
					...Object.values(VERCEL_AI_GATEWAY_MODEL_CATALOG.chat()),
					...Object.values(VERCEL_AI_GATEWAY_MODEL_CATALOG.classifier()),
				];
			},
			api: anthropicMessagesApi(),
			// AI Gateway serves TypeSafe's System One protocol at /typesafe/v1/systemone.
			classifiers: { "typesafe-system-one": typesafeSystemOneApi() },
		}),
		VERCEL_AI_GATEWAY_MODEL_CATALOG,
	);
}
