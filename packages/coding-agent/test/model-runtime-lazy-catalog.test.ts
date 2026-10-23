import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { MODEL_CATALOGS } from "../../ai/src/models.generated.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { findInitialModel, resolveCliModel } from "../src/core/model-resolver.ts";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

const tempDir = join(tmpdir(), `pi-lazy-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}`);
mkdirSync(tempDir, { recursive: true });
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

const modelsPath = join(tempDir, "models.json");
writeFileSync(
	modelsPath,
	JSON.stringify({
		providers: {
			fake: {
				baseUrl: "http://127.0.0.1:9/v1",
				api: "openai-completions",
				apiKey: "fake",
				models: [{ id: "fake-model", contextWindow: 200000, maxTokens: 8192 }],
			},
		},
	}),
);

const built = () => MODEL_CATALOGS.filter((catalog) => catalog.isBuilt()).map((catalog) => catalog.provider);

async function createRuntime(): Promise<ModelRuntime> {
	return getModelRuntime(await createModelRegistry(AuthStorage.inMemory(), modelsPath));
}

/** resolveCliModel() as it was before catalogs were lazy: every model built and looked at. */
function eagerResolveCliModel(options: Parameters<typeof resolveCliModel>[0]) {
	const runtime = options.modelRuntime;
	const eager = Object.create(runtime) as ModelRuntime;
	eager.getModelChoices = () => ({ models: runtime.getModels(), model: (model) => model });
	return resolveCliModel({ ...options, modelRuntime: eager });
}

// The first test sees the catalogs before anything in this file has built them.
describe("ModelRuntime with lazy catalogs", () => {
	test("starts, and resolves the selected and the default model, building only their providers' catalogs", async () => {
		expect(built()).toEqual([]);
		const runtime = await createRuntime();
		// (Providers with credentials in the environment have their models listed as available.)
		const configured = MODEL_CATALOGS.map((catalog) => catalog.provider).filter((id) =>
			runtime.hasConfiguredAuth(id),
		);
		expect(built()).toEqual(configured);

		const selected = resolveCliModel({ cliModel: "fake/fake-model", modelRuntime: runtime });
		expect(selected.error).toBeUndefined();
		// (A models.json provider makes its model objects anew at each call.)
		expect(selected.model).toEqual(runtime.getModel("fake", "fake-model"));
		expect(built()).toEqual(configured);

		const anthropic = resolveCliModel({ cliModel: "anthropic/claude-opus-4-8", modelRuntime: runtime });
		expect(anthropic.model).toBe(runtime.getModel("anthropic", "claude-opus-4-8"));
		expect(built()).toContain("anthropic");
		expect(built().filter((id) => id !== "anthropic" && !configured.includes(id))).toEqual([]);

		const initial = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: "fake",
			defaultModelId: "fake-model",
			modelRuntime: runtime,
		});
		expect(initial.model).toEqual(selected.model);
		expect(built().filter((id) => id !== "anthropic" && !configured.includes(id))).toEqual([]);
	});

	test.each([
		["claude-opus-4-8"],
		["anthropic/claude-opus-4-8"],
		["anthropic/claude-opus-4-8:high"],
		["opus"],
		["sonnet:low"],
		["gpt-5.5"],
		["openai/gpt-5.5"],
		["kimi"],
		["anthropic/claude-opus-5.5"],
		["openrouter/anthropic/claude-opus-4.5"],
		["zai/glm-5.1"],
		["openai/gpt-oss-120b"],
		["anthropic/no-such-model"],
		["anthropic/no-such-model:high"],
		["no-such-model"],
		["fake/fake-model"],
		["FAKE/FAKE-MODEL"],
		["fake-model"],
	])("chooses for --model %s what the eager catalog chooses", async (cliModel) => {
		const runtime = await createRuntime();
		for (const options of [
			{ cliModel },
			{ cliModel, cliProvider: "anthropic" },
			{ cliModel, cliProvider: "OpenRouter" },
			{ cliModel, cliThinking: "high" as const },
			{ cliModel, inlineApiKey: true },
			{ cliModel, cliProvider: "no-such-provider" },
		]) {
			const lazy = resolveCliModel({ ...options, modelRuntime: runtime });
			const eager = eagerResolveCliModel({ ...options, modelRuntime: runtime });
			expect(lazy).toEqual(eager);
			// The catalog's own model object, unless it is a custom model id made from one.
			if (eager.model && !eager.warning && eager.model.provider !== "fake") expect(lazy.model).toBe(eager.model);
		}
	});

	test("lists as available the models of the providers with credentials, in catalog order", async () => {
		const runtime = await createRuntime();
		await runtime.setRuntimeApiKey("openai", "test-key");
		await runtime.setRuntimeApiKey("anthropic", "test-key");
		const expected = runtime.getModels().filter((model) => runtime.hasConfiguredAuth(model.provider));
		expect(expected.some((model) => model.provider === "openai")).toBe(true);
		expect(runtime.getAvailableSnapshot()).toEqual(expected);
		runtime.getAvailableSnapshot().forEach((model, index) => {
			if (model.provider !== "fake") expect(model).toBe(expected[index]);
		});
		await runtime.refresh({ allowNetwork: false });
		expect(runtime.getAvailableSnapshot()).toEqual(
			runtime.getModels().filter((model) => runtime.hasConfiguredAuth(model.provider)),
		);
	});
});
