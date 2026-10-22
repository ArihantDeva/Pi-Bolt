import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { googleGenerativeAIApi } from "../api/google-generative-ai.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { OPENCODE_GO_MODEL_CATALOG } from "./opencode-go.catalog.ts";
import { withOpenCodeSessionHeader } from "./opencode-headers.ts";

type OpenCodeGoApi = "anthropic-messages" | "google-generative-ai" | "openai-completions" | "openai-responses";

export function opencodeGoProvider(): Provider<OpenCodeGoApi> {
	return withCatalogListing(
		createProvider<OpenCodeGoApi>({
			id: "opencode-go",
			name: "OpenCode Go",
			auth: { apiKey: envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"]) },
			get models() {
				return Object.values(OPENCODE_GO_MODEL_CATALOG.chat());
			},
			api: {
				"anthropic-messages": withOpenCodeSessionHeader(anthropicMessagesApi()),
				"google-generative-ai": withOpenCodeSessionHeader(googleGenerativeAIApi()),
				"openai-completions": withOpenCodeSessionHeader(openAICompletionsApi()),
				"openai-responses": withOpenCodeSessionHeader(openAIResponsesApi()),
			},
		}),
		OPENCODE_GO_MODEL_CATALOG,
	);
}
