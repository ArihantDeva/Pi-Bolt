import { googleGenerativeAIApi } from "../api/google-generative-ai.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { GOOGLE_MODEL_CATALOG } from "./google.catalog.ts";
import { withCatalogListing } from "./model-listing.ts";

export function googleProvider(): Provider<"google-generative-ai"> {
	return withCatalogListing(
		createProvider({
			id: "google",
			name: "Google",
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			auth: { apiKey: envApiKeyAuth("Gemini API key", ["GEMINI_API_KEY"]) },
			get models() {
				return Object.values(GOOGLE_MODEL_CATALOG.chat());
			},
			api: googleGenerativeAIApi(),
		}),
		GOOGLE_MODEL_CATALOG,
	);
}
