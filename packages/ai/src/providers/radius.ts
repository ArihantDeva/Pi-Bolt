import { piMessagesApi } from "../api/pi-messages.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadRadiusOAuth } from "../auth/oauth/load.ts";
import type { Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { namedModelListing, setModelListing } from "./model-listing.ts";
import { RADIUS_MODEL_CATALOG } from "./radius.catalog.ts";
import {
	DEFAULT_RADIUS_GATEWAY,
	getRadiusModels,
	getRadiusModelsFromConfig,
	loadRadiusGatewayConfig,
	normalizeRadiusGatewayUrl,
} from "./radius-config.ts";

export interface RadiusProviderOptions {
	id?: string;
	name?: string;
	gateway?: string;
}

/** Radius gateway provider with a persisted, dynamically refreshed catalog. */
export function radiusProvider(options: RadiusProviderOptions = {}): Provider<"pi-messages"> {
	const id = options.id ?? "radius";
	const name = options.name ?? "Radius";
	const gateway = normalizeRadiusGatewayUrl(options.gateway ?? DEFAULT_RADIUS_GATEWAY);
	const defaultGateway = gateway === normalizeRadiusGatewayUrl(DEFAULT_RADIUS_GATEWAY);
	// (Made when first asked for.)
	let baselineModels: Model<"pi-messages">[] | undefined;
	const baseline = (): Model<"pi-messages">[] => {
		baselineModels ??= defaultGateway
			? Object.values(RADIUS_MODEL_CATALOG.chat()).map((model) => ({ ...model, provider: id }))
			: [];
		return baselineModels;
	};
	// Gateway catalog for this account. Radius org owners can disable models, so once known it replaces
	// the shipped baseline instead of overlaying it. The baseline only covers the time before any catalog exists.
	let dynamicModels: Model<"pi-messages">[] | undefined;
	const streams = piMessagesApi();

	const provider: Provider<"pi-messages"> = {
		id,
		name,
		auth: {
			apiKey: envApiKeyAuth("Radius API key", ["RADIUS_API_KEY"]),
			oauth: lazyOAuth({ name, load: () => loadRadiusOAuth({ name, gateway }) }),
		},
		getModels: () => dynamicModels ?? baseline(),
		refreshModels: async (context) => {
			const stored = context.stored;
			if (stored) {
				const restored = stored.models.filter((model) => model.provider === id) as Model<"pi-messages">[];
				if (
					!(await context.publish({
						update: () => {
							dynamicModels = restored;
						},
					}))
				) {
					return;
				}
			}

			// Import catalogs cached by the pre-ModelsStore Radius implementation.
			if (!stored && context.credential?.type === "oauth") {
				const legacy = getRadiusModels(id, context.credential);
				if (legacy.length > 0) {
					if (
						!(await context.publish({
							persist: { models: legacy, checkedAt: Date.now() },
							update: () => {
								dynamicModels = legacy;
							},
						}))
					) {
						return;
					}
				}
			}

			if (!context.allowNetwork || context.signal.aborted) return;
			const apiKey = context.credential?.type === "oauth" ? context.credential.access : context.credential?.key;
			const config = await loadRadiusGatewayConfig(gateway, apiKey, context.signal);
			if (context.signal.aborted) return;
			const refreshed = getRadiusModelsFromConfig(id, config);
			await context.publish({
				persist: { models: refreshed, checkedAt: Date.now() },
				update: () => {
					dynamicModels = refreshed;
				},
			});
		},
		stream: (model, context, streamOptions) => streams.stream(model, context, streamOptions),
		streamSimple: (model, context, streamOptions) => streams.streamSimple(model, context, streamOptions),
	};
	// The shipped baseline can be named without building it until a gateway catalog replaces it.
	const listing = namedModelListing(id, defaultGateway ? RADIUS_MODEL_CATALOG.chatNames : () => [], baseline);
	return setModelListing(provider, () => (dynamicModels === undefined ? listing : undefined));
}
