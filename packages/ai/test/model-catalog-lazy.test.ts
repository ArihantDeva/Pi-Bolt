import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLASSIFIER_MODELS, IMAGE_MODELS, MODEL_CATALOGS, MODELS } from "../src/models.generated.ts";
import {
	builtinModels,
	builtinProviders,
	getBuiltinClassifierModels,
	getBuiltinImageModels,
	getBuiltinModels,
	getBuiltinProviders,
} from "../src/providers/all.ts";
import { getModelListing } from "../src/providers/model-listing.ts";
import type { AnyModel, ModelType } from "../src/types.ts";

const dataDir = fileURLToPath(new URL("../src/providers/data", import.meta.url));
const providerIds = readdirSync(dataDir)
	.filter((file) => file.endsWith(".json") && !file.startsWith("."))
	.map((file) => file.replace(/\.json$/, ""))
	.sort();

const built = () => MODEL_CATALOGS.filter((catalog) => catalog.isBuilt()).map((catalog) => catalog.provider);

/** The records as they were built before catalogs were lazy: from the data file, at module load. */
function eagerRecords(providerId: string): Record<ModelType, Record<string, object>> {
	const groups = JSON.parse(readFileSync(join(dataDir, `${providerId}.json`), "utf8")) as Record<
		string,
		Record<string, object>
	>;
	const flatten = (type: ModelType) =>
		Object.fromEntries(
			Object.values(groups)
				.flatMap((models) => Object.values(models))
				.filter((model) => (model as { type?: unknown }).type === type)
				.map((model) => [(model as { id: string }).id, model]),
		);
	return { chat: flatten("chat"), image: flatten("image"), classifier: flatten("classifier") };
}

// The first tests see the catalogs before anything has built them (vitest runs a file's tests in order, in a module graph
// of its own).
describe("lazy model catalogs", () => {
	it("builds nothing when the providers are created", () => {
		expect(built()).toEqual([]);
		const models = builtinModels();
		expect(getBuiltinProviders()).toEqual(providerIds);
		for (const provider of models.getProviders()) expect(getModelListing(provider)).toBeDefined();
		expect(built()).toEqual([]);
	});

	it("builds only the catalog of the provider asked for", () => {
		const models = builtinModels();
		expect(models.getModel("anthropic", "claude-opus-4-8")?.provider).toBe("anthropic");
		expect(built()).toEqual(["anthropic"]);
		expect(getBuiltinModels("openai").length).toBeGreaterThan(0);
		expect(built()).toEqual(["anthropic", "openai"]);
	});

	it("lists each provider's chat models by name as getModels() returns them", () => {
		for (const provider of builtinProviders()) {
			const listing = getModelListing(provider);
			if (!listing) throw new Error(`${provider.id} has no listing`);
			const models = provider.getModels();
			expect(listing.entries.map((entry) => [entry.provider, entry.id, entry.name])).toEqual(
				models.map((model) => [model.provider, model.id, model.name]),
			);
			expect(listing.models()).toEqual(models);
			listing.models().forEach((model, index) => {
				expect(model).toBe(models[index]);
			});
		}
		expect(built()).toEqual(providerIds);
	});

	it.each(providerIds)("%s: the records are the eager catalog's, in the same order", (providerId) => {
		const eager = eagerRecords(providerId);
		const lazy = {
			chat: (MODELS as Record<string, Record<string, object>>)[providerId],
			image: (IMAGE_MODELS as Record<string, Record<string, object>>)[providerId],
			classifier: (CLASSIFIER_MODELS as Record<string, Record<string, object>>)[providerId],
		};
		for (const type of ["chat", "image", "classifier"] as const) {
			expect(lazy[type]).toStrictEqual(eager[type]);
			// Key order at every level, which toStrictEqual does not compare.
			expect(JSON.stringify(lazy[type])).toBe(JSON.stringify(eager[type]));
		}
		expect(getBuiltinModels(providerId as never)).toEqual(Object.values(eager.chat));
		expect(getBuiltinImageModels(providerId as never)).toEqual(Object.values(eager.image));
		expect(getBuiltinClassifierModels(providerId as never)).toEqual(Object.values(eager.classifier));
	});

	it("gives each provider the models of its catalog, every model with the provider's id", () => {
		for (const provider of builtinProviders()) {
			const all = provider.getAllModels?.() ?? provider.getModels();
			const eager = eagerRecords(provider.id);
			// Each type's models in catalog order, the types in the order chat, image, classifier.
			const types = (["chat", "image", "classifier"] as const).filter((type) =>
				all.some((model) => (model as { type?: unknown }).type === type),
			);
			const expected: AnyModel[] = types.flatMap((type) => Object.values(eager[type]) as AnyModel[]);
			expect(all).toEqual(expected);
			for (const model of all) expect(model.provider).toBe(provider.id);
		}
	});
});
