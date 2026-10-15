import { homedir } from "node:os";
import { parseGitUrl } from "../utils/git.ts";
import { isLocalPath, resolvePath } from "../utils/paths.ts";
import type { PackageSource } from "./settings-schema.ts";

/** Package identity excludes npm versions and git refs; local paths are relative to their settings file. */
export function getPackageIdentity(source: string, baseDir: string): string {
	if (source.startsWith("npm:")) {
		const spec = source.slice(4).trim();
		return `npm:${spec.match(/^(@?[^@]+)(?:@(.+))?$/)?.[1] ?? spec}`;
	}
	const git = isLocalPath(source) ? null : parseGitUrl(source);
	if (git) return `git:${git.host}/${git.path}`;
	return `local:${resolvePath(source, baseDir, { homeDir: process.env.HOME || homedir(), trim: true })}`;
}

/** Apply this file's overlay in order, before project/global package precedence. Last entry for an identity wins. */
export function resolvePackageOverlay(
	shared: PackageSource[],
	overrides: PackageSource[],
	baseDir: string,
): PackageSource[] {
	const identity = (entry: PackageSource) =>
		getPackageIdentity(typeof entry === "string" ? entry : entry.source, baseDir);
	let packages = [...shared];
	for (const entry of overrides) {
		const excluded = typeof entry === "string" && entry.startsWith("-");
		const key = excluded ? getPackageIdentity(entry.slice(1), baseDir) : identity(entry);
		const index = packages.findIndex((pkg) => identity(pkg) === key);
		packages = packages.filter((pkg) => identity(pkg) !== key);
		if (!excluded) packages.splice(index === -1 ? packages.length : index, 0, entry);
	}
	return packages;
}
