#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGeneratedModelData } from "./model-data.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
	validateGeneratedModelData(packageRoot);
	console.log("Generated model data is valid.");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(
		"\nModel data or its catalog modules are missing or stale. Run `npm run generate-catalog-modules` in packages/ai, or `npm run hydrate:model-data` from the repository root.",
	);
	process.exitCode = 1;
}
