#!/usr/bin/env node

// Writes the catalog's TypeScript modules (scripts/model-catalog-modules.ts) from the data files as they are, without
// fetching anything: for a change to how the modules are written. `npm run generate-models` writes them with new data.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeModelCatalogModules } from "./model-catalog-modules.ts";
import { MODEL_DATA_MANIFEST_FILE, validateGeneratedModelData } from "./model-data.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(packageRoot, "src", "providers", "data");
const manifest = JSON.parse(readFileSync(join(dataDir, MODEL_DATA_MANIFEST_FILE), "utf8")) as { files: Record<string, string> };
const dataTexts = Object.fromEntries(
	Object.keys(manifest.files).map((file) => [file.replace(/\.json$/, ""), readFileSync(join(dataDir, file), "utf8")] as const),
);
writeModelCatalogModules(packageRoot, dataTexts);
validateGeneratedModelData(packageRoot);
console.log(`Wrote the catalog modules of ${Object.keys(dataTexts).length} providers`);
