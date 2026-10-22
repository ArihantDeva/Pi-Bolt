import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { createProvider, type Provider } from "../models.ts";
import { CLOUDFLARE_AI_GATEWAY_MODEL_CATALOG } from "./cloudflare-ai-gateway.catalog.ts";
import { cloudflareAIGatewayAuth } from "./cloudflare-auth.ts";
import { cloudflareStreams } from "./cloudflare-stream.ts";
import { withCatalogListing } from "./model-listing.ts";

type CloudflareAIGatewayApi = "anthropic-messages" | "openai-completions" | "openai-responses";

export function cloudflareAIGatewayProvider(): Provider<CloudflareAIGatewayApi> {
	// The api map is pinned to all three APIs: models.dev's gateway catalog drops and
	// restores `workers-ai/*` (openai-completions) entries over time, and inference from
	// `models` alone would otherwise reject the openai-completions entry whenever the
	// generated catalog happens to contain none.
	return withCatalogListing(
		createProvider<CloudflareAIGatewayApi>({
			id: "cloudflare-ai-gateway",
			name: "Cloudflare AI Gateway",
			auth: { apiKey: cloudflareAIGatewayAuth() },
			get models() {
				return Object.values(CLOUDFLARE_AI_GATEWAY_MODEL_CATALOG.chat());
			},
			api: {
				"anthropic-messages": cloudflareStreams(anthropicMessagesApi()),
				"openai-completions": cloudflareStreams(openAICompletionsApi()),
				"openai-responses": cloudflareStreams(openAIResponsesApi()),
			},
		}),
		CLOUDFLARE_AI_GATEWAY_MODEL_CATALOG,
	);
}
