#!/usr/bin/env node
/**
 * Writes the plugin folder that `build-pi.sh --plugins` takes, from the extensions installed on this machine.
 *
 * docs/PLUGINS.md step 1 is four steps done by hand: repeat Pi's discovery rules, name each extension, copy its folder
 * where the bundler can reach it, and bring its dependencies. Every one of them fails quietly, because an extension left
 * out of the manifest still loads at run time. The session looks right and only the compiled-in list is short.
 *
 * The discovery rules below are Pi's, and Pi is the source of truth for them:
 * packages/coding-agent/src/core/extensions/loader.ts, `discoverExtensionsInDir` and `resolveExtensionEntries`. They are
 * repeated here rather than imported because this script belongs to Pi-Bolt and those functions are Pi's, and private.
 * `assertMatchesPiRules` in scripts/gen-plugin-manifest.test.mjs covers each rule, so a change in Pi shows up as a failing
 * test rather than as a short manifest.
 *
 * Usage: scripts/gen-plugin-manifest.mjs --out DIR [options]
 *   --out DIR           where the plugin folder goes (required; replaced if a previous run wrote it)
 *   --agent-dir DIR     the agent directory (default: $PI_CODING_AGENT_DIR, else ~/.pi/agent)
 *   --cwd DIR           also take DIR/.pi/extensions, a project's own folder (default: no project)
 *   --only a,b          only these extensions, by the name this prints (repeatable)
 *   --exclude a,b       every extension except these (repeatable)
 *   --no-packages       leave out the packages `pi install` installed
 *   --json              print the plan as JSON instead of a summary
 *
 * The agent directory's `settings.json` supplies the `extensions` paths and the `packages` list. A project's settings are
 * not read: Pi honours those only in a trusted project, and this script cannot tell whether a project is trusted.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR_NAME = ".pi";
const HERE = dirname(fileURLToPath(import.meta.url));

function die(message) {
	process.stderr.write(`error: ${message}\n`);
	process.exit(1);
}

function readJson(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// --- Pi's discovery rules (loader.ts) -------------------------------------------------------------------------------

const isExtensionFile = (name) => name.endsWith(".ts") || name.endsWith(".js");

/** Rule 3 then rule 2: a package.json with a "pi.extensions" list, else an index. Returns absolute paths, or undefined. */
export function resolveExtensionEntries(dir) {
	const manifest = readJson(join(dir, "package.json"));
	const declared = manifest?.pi?.extensions;
	if (Array.isArray(declared) && declared.length > 0) {
		const entries = declared.map((entry) => resolve(dir, entry)).filter((entry) => existsSync(entry));
		if (entries.length > 0) return entries;
	}
	for (const index of ["index.ts", "index.js"]) {
		if (existsSync(join(dir, index))) return [join(dir, index)];
	}
	return undefined;
}

/** Rule 1 and rules 2-3 for each subfolder. One level only, as Pi does. */
export function discoverExtensionsInDir(dir) {
	if (!existsSync(dir)) return [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const found = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
			found.push(path);
			continue;
		}
		if (entry.isDirectory() || entry.isSymbolicLink()) {
			found.push(...(resolveExtensionEntries(path) ?? []));
		}
	}
	return found;
}

// --- names ----------------------------------------------------------------------------------------------------------

/** A name the `extensions` setting can carry: it is one flat string, so a space would split it. */
function safeName(raw) {
	const cleaned = raw
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned.length > 0 ? cleaned : "extension";
}

/** `pdf-reader` -> `pdfReader`, the binding the manifest imports the factory as. */
function toIdentifier(name) {
	const camel = name
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
		.join("");
	return /^[A-Za-z_$]/.test(camel) ? camel : `ext${camel}`;
}

const withoutExtension = (file) => file.replace(/\.(ts|js)$/, "");

/** Unique within `taken`, by a suffix and then a number. Adds to `taken`. */
function unique(candidate, taken, suffix) {
	if (!taken.has(candidate)) return taken.add(candidate), candidate;
	if (suffix && !taken.has(`${candidate}-${suffix}`)) {
		return taken.add(`${candidate}-${suffix}`), `${candidate}-${suffix}`;
	}
	for (let n = 2; ; n++) {
		if (!taken.has(`${candidate}-${n}`)) return taken.add(`${candidate}-${n}`), `${candidate}-${n}`;
	}
}

/**
 * The name an extension gets. A direct file is its own name, and a folder is the folder's. A folder that declares several
 * entries names each one after its file, so they stay apart.
 *
 * `index` is never a name. A path in the `extensions` setting points at the entry itself, so discovery starts from the
 * extension's own folder and the entry is a bare `index.ts`: three of those would be `index`, `index-2`, `index-3`.
 */
function baseName(entryRelative, siblings, rootName) {
	const segments = entryRelative.split("/");
	if (segments.length === 1) {
		const file = withoutExtension(segments[0]);
		return file === "index" ? rootName : file;
	}
	return siblings <= 1 ? segments[0] : `${segments[0]}-${withoutExtension(segments.at(-1))}`;
}

// --- packages installed with `pi install` ---------------------------------------------------------------------------

/** Pi's own packages: the build resolves these to Pi's modules, and a copy of one would be a second Pi. */
const isPiPackage = (name) => name === "typebox" || name.startsWith("@earendil-works/pi-");

/**
 * The folder `pi install` put a package in. The `packages` setting records a source and not a path: `npm:pi-lens`,
 * `npm:opensec-pi-todo@2.13.0`, `npm:@scope/name`. A `git:` source is checked out under a hashed folder name that only
 * Pi's package manager can work out, so those are reported instead of guessed at.
 */
function managedPackageFolder(entry, agentDir) {
	if (!entry.startsWith("npm:")) {
		return { skip: `${entry}: only npm: packages can be compiled in (a git: checkout is resolved by Pi)` };
	}
	const spec = entry.slice(4);
	// A pinned version has a trailing @, which a scope's leading @ must not be mistaken for.
	const at = spec.lastIndexOf("@");
	const name = at > 0 ? spec.slice(0, at) : spec;
	const dir = join(agentDir, "npm", "node_modules", ...name.split("/"));
	return existsSync(dir) ? { name, dir } : { skip: `${name}: not installed at ${dir}` };
}

/**
 * Whether a package's entry is the Bun build that loads its real code at run time. Those ship `dist-bun/index.js` beside
 * a `dist-bun/core.cjs`, and the entry requires the core by a path it works out as it runs, which a compiled executable
 * has no file for. Compiling one in means unwrapping the core and handing it Pi's modules, which is a job per package:
 * plugins/opensec/ is the worked example.
 */
const needsVendoring = (entry) => existsSync(join(dirname(entry), "core.cjs"));

/** A package.json's dependency names that a build has to resolve: the required ones, and the optional ones installed. */
function dependencyNames(manifest) {
	const names = [];
	for (const field of ["dependencies", "optionalDependencies"]) {
		const value = manifest?.[field];
		if (value && typeof value === "object") names.push(...Object.keys(value));
	}
	return names;
}

/**
 * Every package a package needs, transitively. `pi install` hoists into one flat node_modules, so a package's
 * dependencies are its siblings and not inside it: copying the package folder alone leaves them for the bundler to fail
 * on. `peerDependencies` are not walked -- those are the host's to provide, and a missing one is a loud build error.
 */
function dependencyClosure(dir, root) {
	const found = new Map();
	const queue = [dir];
	const visited = new Set([resolve(dir)]);
	while (queue.length > 0) {
		const current = queue.shift();
		for (const name of dependencyNames(readJson(join(current, "package.json")))) {
			if (isPiPackage(name) || found.has(name)) continue;
			// Nested before hoisted, as Node resolves: a package may carry its own copy of a version the root hoisted differently.
			const nested = join(current, "node_modules", ...name.split("/"));
			const hoisted = join(root, ...name.split("/"));
			const resolved = existsSync(nested) ? nested : existsSync(hoisted) ? hoisted : undefined;
			if (!resolved) continue;
			found.set(name, resolved);
			if (!visited.has(resolve(resolved))) {
				visited.add(resolve(resolved));
				queue.push(resolved);
			}
		}
	}
	return found;
}

// --- the plan -------------------------------------------------------------------------------------------------------

/** Everything in a folder that discovery passed over, so the summary can say why. */
function describeSkipped(root, discovered) {
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const skipped = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (discovered.has(resolve(path))) continue;
		if (entry.isDirectory() || entry.isSymbolicLink()) {
			if (resolveExtensionEntries(path)) continue;
			const empty = existsSync(path) && readdirSync(path).length === 0;
			skipped.push({
				path,
				reason: empty
					? "empty folder"
					: 'no index.ts, index.js, or package.json with a "pi.extensions" field (shared code, not an extension)',
			});
			continue;
		}
		if (entry.isFile() && !isExtensionFile(entry.name)) skipped.push({ path, reason: "not a .ts or .js file" });
	}
	return skipped;
}

export function planPlugins(options) {
	const agentDir = resolve(options.agentDir);
	const settings = readJson(join(agentDir, "settings.json")) ?? {};
	const configured = Array.isArray(settings.extensions) ? settings.extensions.filter((p) => typeof p === "string") : [];
	const packages =
		options.noPackages || !Array.isArray(settings.packages)
			? []
			: settings.packages.filter((p) => typeof p === "string");

	/** Each source folder, in the order Pi discovers them: the project, then the agent directory, then configured paths. */
	const sources = [];
	if (options.cwd) sources.push({ origin: "project", root: join(resolve(options.cwd), CONFIG_DIR_NAME, "extensions") });
	sources.push({ origin: "global", root: join(agentDir, "extensions") });

	const seen = new Set();
	const entries = [];
	const addEntry = (path, origin, root) => {
		if (seen.has(resolve(path))) return;
		seen.add(resolve(path));
		entries.push({ path, origin, root });
	};
	for (const source of sources) {
		for (const path of discoverExtensionsInDir(source.root)) addEntry(path, source.origin, source.root);
	}
	const passedOver = [];
	for (const raw of configured) {
		// A pattern (`-path`, `!path`, `+path`, a glob) or `builtin:<name>` filters what Pi loads; it names no extension to copy.
		if (/^[!+-]/.test(raw) || /[*?]/.test(raw) || raw.startsWith("builtin:")) continue;
		const path = resolve(raw.startsWith("~") ? join(homedir(), raw.slice(1)) : raw);
		if (!existsSync(path)) {
			passedOver.push({ path, reason: "in the extensions setting, but not found" });
			continue;
		}
		if (statSync(path).isDirectory()) {
			const declared = resolveExtensionEntries(path);
			for (const entry of declared ?? discoverExtensionsInDir(path)) addEntry(entry, "configured", path);
			continue;
		}
		addEntry(path, "configured", dirname(path));
	}

	const takenStageDirs = new Set();
	const takenNames = new Set();
	const takenIdentifiers = new Set();
	const stageDirs = new Map();
	const roots = [];
	const plugins = [];

	const stageDirFor = (origin, root) =>
		origin === "project" || origin === "global"
			? unique(origin, takenStageDirs)
			: unique(`path-${safeName(basename(root))}`, takenStageDirs);

	// How many entries each top-level folder of a root holds, so a folder declaring several gets a name per entry.
	const perFolder = new Map();
	for (const entry of entries) {
		const key = `${resolve(entry.root)} ${relative(entry.root, entry.path).split(sep)[0]}`;
		perFolder.set(key, (perFolder.get(key) ?? 0) + 1);
	}

	for (const entry of entries) {
		const root = resolve(entry.root);
		if (!stageDirs.has(root)) {
			const stageDir = stageDirFor(entry.origin, root);
			stageDirs.set(root, stageDir);
			roots.push({ stageDir, root, origin: entry.origin });
		}
		const rel = relative(entry.root, entry.path).split(sep).join("/");
		const siblings = perFolder.get(`${root} ${rel.split("/")[0]}`) ?? 1;
		const name = unique(safeName(baseName(rel, siblings, basename(root))), takenNames, entry.origin);
		plugins.push({
			name,
			identifier: unique(toIdentifier(name), takenIdentifiers),
			entry: entry.path,
			origin: entry.origin,
			stageDir: stageDirs.get(root),
			importPath: `./${stageDirs.get(root)}/${rel}`,
		});
	}

	const skipped = [...passedOver, ...roots.flatMap((root) => describeSkipped(root.root, seen))];

	const hoisted = join(agentDir, "npm", "node_modules");
	for (const source of packages) {
		const resolved = managedPackageFolder(source, agentDir);
		if (resolved.skip) {
			skipped.push({ path: source, reason: resolved.skip });
			continue;
		}
		const declared = resolveExtensionEntries(resolved.dir);
		if (!declared) {
			skipped.push({ path: resolved.dir, reason: `${resolved.name}: no entry point and no "pi.extensions"` });
			continue;
		}
		if (declared.some(needsVendoring)) {
			skipped.push({
				path: resolved.dir,
				reason: `${resolved.name}: a Bun build that loads core.cjs at run time, which needs vendoring per package (plugins/opensec/)`,
			});
			continue;
		}
		const stageDir = unique(`package-${safeName(resolved.name)}`, takenStageDirs);
		roots.push({ stageDir, root: resolve(resolved.dir), origin: "package" });
		for (const entry of declared) {
			const rel = relative(resolved.dir, entry).split(sep).join("/");
			const base = declared.length === 1 ? resolved.name : `${resolved.name}-${withoutExtension(basename(entry))}`;
			const name = unique(safeName(base), takenNames, "package");
			plugins.push({
				name,
				identifier: unique(toIdentifier(name), takenIdentifiers),
				entry,
				origin: "package",
				stageDir,
				importPath: `./${stageDir}/${rel}`,
			});
		}
	}

	const only = (options.only ?? []).filter(Boolean);
	const exclude = new Set(options.exclude ?? []);
	const chosen = plugins
		.filter((plugin) => only.length === 0 || only.includes(plugin.name))
		.filter((plugin) => !exclude.has(plugin.name));

	// Only the folders something chosen comes from are copied, and only the dependencies of a chosen package.
	const used = new Set(chosen.map((plugin) => plugin.stageDir));
	const usedRoots = roots.filter((root) => used.has(root.stageDir));
	const dependencies = new Map();
	for (const root of usedRoots) {
		if (root.origin !== "package") continue;
		for (const [name, from] of dependencyClosure(root.root, hoisted)) {
			if (!dependencies.has(name)) dependencies.set(name, from);
		}
	}

	return {
		plugins: chosen,
		roots: usedRoots,
		dependencies: [...dependencies].map(([name, from]) => ({ name, from })),
		skipped,
	};
}

// --- output ---------------------------------------------------------------------------------------------------------

export function renderManifest(plan) {
	const lines = [
		"/**",
		" * Generated: the extensions found on this machine, compiled into the executable.",
		" *",
		" * Written by scripts/gen-plugin-manifest.mjs. Do not edit: the generator replaces this file, and the folders",
		" * beside it, every time it runs. The extensions came from",
	];
	for (const root of plan.roots) lines.push(` *   ${root.stageDir}/ <- ${root.root}`);
	lines.push(
		" *",
		" * Each is named, so it is a built-in extension once compiled in: `-builtin:<name>` in the `extensions` setting",
		" * turns one off, and the same extension installed at run time replaces it instead of conflicting.",
		" */",
		// A value import from the package would evaluate Pi's whole public API at every launch (docs/PLUGINS.md).
		'import type { InlineExtension } from "@earendil-works/pi-coding-agent";',
	);
	for (const plugin of plan.plugins) lines.push(`import ${plugin.identifier} from "${plugin.importPath}";`);
	lines.push("", "const plugins: InlineExtension[] = [");
	for (const plugin of plan.plugins) {
		lines.push(`\t{ name: "${plugin.name}", builtin: true, replaceable: true, factory: ${plugin.identifier} },`);
	}
	lines.push("];", "", "export default plugins;");
	return `${lines.join("\n")}\n`;
}

/** Pi's own packages, which the build resolves to Pi's modules. A copy of one inside a plugin would be a second Pi. */
const EXCLUDED = [join("node_modules", "typebox"), join("node_modules", "@earendil-works")];

function copyRoot(from, to) {
	cpSync(from, to, {
		recursive: true,
		// An extension may be a symbolic link to somewhere else on this machine, which the executable has no file for.
		dereference: true,
		filter: (source) => basename(source) !== ".git" && !EXCLUDED.some((part) => source.includes(part)),
	});
}

/**
 * Writes the folder `--plugins` takes. Returns the manifest's path. `out` is replaced when it holds a manifest from a
 * previous run, and refused when it holds anything else.
 */
export function writePluginFolder(plan, out) {
	const manifest = join(out, "plugins.ts");
	if (existsSync(out)) {
		if (readdirSync(out).length > 0 && !existsSync(manifest)) {
			die(`${out} is not empty and holds no generated plugins.ts: refusing to overwrite it`);
		}
		rmSync(out, { recursive: true, force: true });
	}
	mkdirSync(out, { recursive: true });
	for (const root of plan.roots) copyRoot(root.root, join(out, root.stageDir));
	// One node_modules beside the manifest, as the hoisted root it came from has and as docs/PLUGINS.md expects: Node
	// resolution walks up from each staged folder, so every package finds its dependencies here.
	for (const dependency of plan.dependencies) {
		copyRoot(dependency.from, join(out, "node_modules", ...dependency.name.split("/")));
	}
	writeFileSync(manifest, renderManifest(plan));
	return manifest;
}

// --- the command ----------------------------------------------------------------------------------------------------

const HELP = `Usage: scripts/gen-plugin-manifest.mjs --out DIR [options]

  --out DIR           where the plugin folder goes (required)
  --agent-dir DIR     the agent directory (default: $PI_CODING_AGENT_DIR, else ~/.pi/agent)
  --cwd DIR           also take DIR/${CONFIG_DIR_NAME}/extensions, a project's own folder
  --only a,b          only these extensions, by the name this prints (repeatable)
  --exclude a,b       every extension except these (repeatable)
  --no-packages       leave out the packages "pi install" installed
  --json              print the plan as JSON
`;

function parseArgs(argv) {
	const options = { out: "", agentDir: "", cwd: "", only: [], exclude: [], noPackages: false, json: false };
	let index = 0;
	while (index < argv.length) {
		const arg = argv[index];
		const value = argv[index + 1];
		const needsValue = () => {
			if (value === undefined) die(`${arg} needs a value`);
			index += 1;
			return value;
		};
		index += 1;
		switch (arg) {
			case "--out": options.out = needsValue(); break;
			case "--agent-dir": options.agentDir = needsValue(); break;
			case "--cwd": options.cwd = needsValue(); break;
			case "--only": options.only.push(...needsValue().split(",").map((n) => n.trim()).filter(Boolean)); break;
			case "--exclude": options.exclude.push(...needsValue().split(",").map((n) => n.trim()).filter(Boolean)); break;
			case "--no-packages": options.noPackages = true; break;
			case "--json": options.json = true; break;
			case "-h":
			case "--help": process.stdout.write(HELP); process.exit(0); break;
			default: die(`unknown option ${arg}`);
		}
	}
	return options;
}

/** The agent directory, as Pi resolves it (packages/coding-agent/src/config.ts, getAgentDir). */
export function defaultAgentDir(env = process.env) {
	const fromEnv = env.PI_CODING_AGENT_DIR;
	if (fromEnv) return fromEnv.startsWith("~") ? join(homedir(), fromEnv.slice(1)) : fromEnv;
	return join(homedir(), CONFIG_DIR_NAME, "agent");
}

// Imported by the test; run only as a command.
if (resolve(process.argv[1] ?? "") === resolve(join(HERE, "gen-plugin-manifest.mjs"))) {
	const options = parseArgs(process.argv.slice(2));
	if (!options.out) die("--out DIR is required");
	const plan = planPlugins({ ...options, agentDir: options.agentDir || defaultAgentDir() });

	const missing = options.only.filter((name) => !plan.plugins.some((plugin) => plugin.name === name));
	if (missing.length > 0) die(`no extension is named ${missing.join(", ")}`);
	if (plan.plugins.length === 0) die("no extensions found to compile in");

	const manifest = writePluginFolder(plan, resolve(options.out));

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ manifest, ...plan }, null, 2)}\n`);
	} else {
		for (const plugin of plan.plugins) process.stderr.write(`  ${plugin.name} (${plugin.origin})\n`);
		if (plan.dependencies.length > 0) {
			process.stderr.write(`  with ${plan.dependencies.length} dependency package(s), copied to node_modules\n`);
		}
		for (const entry of plan.skipped) process.stderr.write(`  passed over: ${entry.path}\n    ${entry.reason}\n`);
		// The manifest's path alone on stdout: build-pi.sh reads it with a command substitution.
		process.stdout.write(`${manifest}\n`);
	}
}
