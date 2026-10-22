import type { Provider } from "../models.ts";
import type { Api, Model } from "../types.ts";

/** A chat model named without being built. */
export interface ModelListingEntry {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
}

/**
 * What a provider's `getModels()` returns, named without building the models: `entries[i]` is the provider, id and name of
 * `models()[i]`, and `models()` is the list `getModels()` returned when the listing was given, the same objects in the
 * same order (built when it is first called). Lookups that need only names can run on the entries and build only the
 * provider they pick. Every model's `provider` is the provider's id.
 */
export interface ModelListing {
	readonly entries: readonly ModelListingEntry[];
	models(): readonly Model<Api>[];
}

const listings = new WeakMap<Provider, () => ModelListing | undefined>();

/**
 * Says how to name `provider`'s chat models without building them, for as long as `listing` returns a listing: it returns
 * undefined once `getModels()` would return something else (models fetched since, for one). Returns `provider`.
 */
export function setModelListing<TProvider extends Provider>(
	provider: TProvider,
	listing: () => ModelListing | undefined,
): TProvider {
	listings.set(provider, listing);
	return provider;
}

/** `provider`'s models named without building them, or undefined if it cannot name them now. */
export function getModelListing(provider: Provider): ModelListing | undefined {
	return listings.get(provider)?.();
}

/**
 * A listing of the chat models `names` names (id, name, id, name, ...; a catalog's `chatNames`), each with provider id
 * `provider`. `models` returns the models themselves, the same list at every call.
 */
export function namedModelListing(
	provider: string,
	names: () => readonly string[],
	models: () => readonly Model<Api>[],
): ModelListing {
	let entries: ModelListingEntry[] | undefined;
	return {
		get entries() {
			if (!entries) {
				const list = names();
				entries = [];
				for (let i = 0; i < list.length; i += 2) entries.push({ provider, id: list[i], name: list[i + 1] });
			}
			return entries;
		},
		models,
	};
}

/** Registers the listing of a provider whose `getModels()` always lists `catalog`'s chat models. Returns `provider`. */
export function withCatalogListing<TProvider extends Provider>(
	provider: TProvider,
	catalog: { chatNames(): readonly string[] },
): TProvider {
	const listing = namedModelListing(provider.id, catalog.chatNames, () => provider.getModels());
	return setModelListing(provider, () => listing);
}
