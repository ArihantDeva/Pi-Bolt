/**
 * Pi-Bolt: extensions compiled into the executable by `pi-bolt compile` (src/pi-bolt-compile.ts).
 *
 * Each stands in for an extension installed on this machine for as long as that extension is as it was when it was compiled
 * in. Pi finds, filters and orders its extensions as always; the one at a compiled-in path then gets the compiled factory
 * instead of being loaded from its files (jiti) again. One changed since is loaded from its files, with a warning; one removed
 * since, or turned off, is not loaded at all. With nothing compiled in (every other build), nothing here is used.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionFactory } from "./types.ts";

/** Where a compiled-in extension came from, and what its files were then. */
export interface CompiledExtensionSource {
	/** The name the manifest gave it. */
	name: string;
	/** Its entry file, a real path, as Pi finds it at run time. */
	entry: string;
	/**
	 * What its fingerprint covers: the entry `file` alone; the `folder` the extension is (`root`), its own files without
	 * node_modules; or the `package` in `root`, by its version and entry.
	 */
	scope: "file" | "folder" | "package";
	root: string;
	fingerprint: string;
}

export interface CompiledExtension extends CompiledExtensionSource {
	factory: ExtensionFactory;
}

/** A folder extension with more files than this is fingerprinted by the first ones (a start reads no more). */
const MAX_FOLDER_FILES = 2000;

let compiled: Map<string, CompiledExtension> | undefined;

export function setCompiledExtensions(extensions: readonly CompiledExtension[]): void {
	compiled = extensions.length > 0 ? new Map(extensions.map((extension) => [extension.entry, extension])) : undefined;
}

function statPart(path: string): string {
	const stats = statSync(path);
	return `${stats.size}:${Math.trunc(stats.mtimeMs)}`;
}

/** The fingerprint of an extension's files as they are now; undefined when its entry is gone. */
export function extensionFingerprint(
	source: Pick<CompiledExtensionSource, "entry" | "scope" | "root">,
): string | undefined {
	try {
		switch (source.scope) {
			case "file":
				return `file:${statPart(source.entry)}`;
			case "package": {
				const manifest = JSON.parse(readFileSync(join(source.root, "package.json"), "utf8")) as {
					version?: unknown;
				};
				return `package:${String(manifest.version)}:${statPart(source.entry)}`;
			}
			case "folder": {
				statSync(source.entry);
				let count = 0;
				let size = 0;
				let newest = 0;
				const walk = (dir: string): void => {
					for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
						a.name < b.name ? -1 : 1,
					)) {
						if (count >= MAX_FOLDER_FILES) return;
						if (entry.name === "node_modules" || entry.name === ".git") continue;
						const path = join(dir, entry.name);
						if (entry.isDirectory()) {
							walk(path);
						} else if (entry.isFile()) {
							const stats = statSync(path);
							count++;
							size += stats.size;
							newest = Math.max(newest, Math.trunc(stats.mtimeMs));
						}
					}
				};
				walk(source.root);
				return `folder:${count}:${size}:${newest}`;
			}
		}
	} catch {
		return undefined;
	}
}

/**
 * For the extension at `path` (resolved): the compiled factory while its files are as they were compiled in, or the
 * compiled extension it has changed from. Undefined when it is not compiled in.
 */
export function compiledExtensionFor(
	path: string,
): { factory: ExtensionFactory } | { changed: CompiledExtension } | undefined {
	if (!compiled) return undefined;
	let extension = compiled.get(path);
	if (!extension) {
		try {
			extension = compiled.get(realpathSync(path));
		} catch {
			return undefined;
		}
		if (!extension) return undefined;
	}
	return extensionFingerprint(extension) === extension.fingerprint
		? { factory: extension.factory }
		: { changed: extension };
}
