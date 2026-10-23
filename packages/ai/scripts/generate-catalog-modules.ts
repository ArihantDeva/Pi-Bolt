#!/usr/bin/env node

// Writes the catalog modules, providers/<provider>.catalog.generated.ts (scripts/model-catalog-modules.ts), from the data files as they
// are, without fetching anything. They are not kept in git: every build (build:offline) and `npm run check` and `npm test` at
// the repository root write them first. With --sources, also writes the committed provider shards and models.generated.ts,
// for a change to how those are written.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeModelCatalogModules } from "./model-catalog-modules.ts";
import { MODEL_DATA_MANIFEST_FILE, validateGeneratedModelData } from "./model-data.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(packageRoot, "src", "providers", "data");
const sources = process.argv.includes("--sources");
let manifest: { files: Record<string, string> };
try {
	manifest = JSON.parse(readFileSync(join(dataDir, MODEL_DATA_MANIFEST_FILE), "utf8"));
} catch (error) {
	console.error(`No model data in ${dataDir}: ${error instanceof Error ? error.message : String(error)}`);
	console.error("Run `npm run hydrate:model-data` from the repository root first.");
	process.exit(1);
}
const dataTexts = Object.fromEntries(
	Object.keys(manifest.files).map((file) => [file.replace(/\.json$/, ""), readFileSync(join(dataDir, file), "utf8")] as const),
);
writeModelCatalogModules(packageRoot, dataTexts, { catalogsOnly: !sources });
validateGeneratedModelData(packageRoot);
console.log(`Wrote the catalog modules of ${Object.keys(dataTexts).length} providers${sources ? " and their sources" : ""}`);
