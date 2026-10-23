import { describe, expect, it } from "vitest";
import { CLASSIFIER_MODELS, IMAGE_MODELS, MODELS } from "../src/models.generated.ts";
import {
	ANTHROPIC_CLASSIFIER_MODELS,
	ANTHROPIC_IMAGE_MODELS,
	ANTHROPIC_MODELS,
} from "../src/providers/anthropic.models.ts";
import { OPENAI_CLASSIFIER_MODELS } from "../src/providers/openai.models.ts";
import { OPENROUTER_IMAGE_MODELS, OPENROUTER_MODELS } from "../src/providers/openrouter.models.ts";

// (Importing a provider's models module builds its catalog: model-catalog-lazy.test.ts checks what is built when.)
describe("provider models modules", () => {
	it("export the catalogs' own records", () => {
		expect(ANTHROPIC_MODELS).toBe(MODELS.anthropic);
		expect(ANTHROPIC_IMAGE_MODELS).toBe(IMAGE_MODELS.anthropic);
		expect(ANTHROPIC_CLASSIFIER_MODELS).toBe(CLASSIFIER_MODELS.anthropic);
		expect(OPENROUTER_MODELS).toBe(MODELS.openrouter);
		expect(OPENROUTER_IMAGE_MODELS).toBe(IMAGE_MODELS.openrouter);
		expect(OPENAI_CLASSIFIER_MODELS).toBe(CLASSIFIER_MODELS.openai);
		expect(Object.keys(OPENROUTER_IMAGE_MODELS).length).toBeGreaterThan(0);
	});
});
