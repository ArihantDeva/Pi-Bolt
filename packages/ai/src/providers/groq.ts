import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { GROQ_MODEL_CATALOG } from "./groq.catalog.generated.ts";
import { withCatalogListing } from "./model-listing.ts";

export function groqProvider(): Provider<"openai-completions"> {
	return withCatalogListing(
		createProvider({
			id: "groq",
			name: "Groq",
			baseUrl: "https://api.groq.com/openai/v1",
			auth: { apiKey: envApiKeyAuth("Groq API key", ["GROQ_API_KEY"]) },
			get models() {
				return Object.values(GROQ_MODEL_CATALOG.chat());
			},
			api: openAICompletionsApi(),
		}),
		GROQ_MODEL_CATALOG,
	);
}
