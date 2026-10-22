import { typesafeSystemOneApi } from "../api/typesafe-system-one.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { withCatalogListing } from "./model-listing.ts";
import { TYPESAFE_MODEL_CATALOG } from "./typesafe.catalog.ts";

export function typesafeProvider(): Provider {
	return withCatalogListing(
		createProvider({
			id: "typesafe",
			name: "TypeSafe",
			auth: {
				apiKey: envApiKeyAuth("TypeSafe API key", ["TYPESAFE_API_KEY"]),
			},
			get models() {
				return Object.values(TYPESAFE_MODEL_CATALOG.classifier());
			},
			classifiers: {
				"typesafe-system-one": typesafeSystemOneApi(),
			},
		}),
		TYPESAFE_MODEL_CATALOG,
	);
}
