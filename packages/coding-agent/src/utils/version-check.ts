import { compare, valid } from "semver";
import {
	PIBOLT,
	PIBOLT_LATEST_RELEASE_API,
	PIBOLT_RELEASES_API,
	piBoltChannel,
	piBoltVersionOfTag,
} from "../pi-bolt.ts";
import { fetchWithRetry } from "./management-http.ts";
import { getPiUserAgent } from "./pi-user-agent.ts";

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestPiRelease {
	version: string;
	packageName?: string;
	note?: string;
}

/** Include useful errno details hidden behind Node's generic "fetch failed" error. */
export function formatVersionCheckError(error: unknown): string {
	const rootMessage = error instanceof Error && error.message ? error.message : String(error);
	const cause = error instanceof Error ? error.cause : undefined;
	const causes = cause instanceof AggregateError ? cause.errors : cause === undefined ? [] : [cause];
	const codes = causes
		.map((value) =>
			typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
				? value.code
				: undefined,
		)
		.filter((code): code is string => code !== undefined);

	if (codes.length > 0) return `${rootMessage} (${[...new Set(codes)].join(", ")})`;
	const causeMessage = causes.find(
		(value): value is Error => value instanceof Error && Boolean(value.message),
	)?.message;
	return causeMessage ? `${rootMessage} (cause: ${causeMessage})` : rootMessage;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestPiRelease(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<LatestPiRelease | undefined> {
	if (process.env.PI_OFFLINE) return undefined;
	if (PIBOLT) return getLatestPiBoltRelease(currentVersion, options);

	const response = await fetchWithRetry(
		LATEST_VERSION_URL,
		{
			headers: {
				"User-Agent": getPiUserAgent(currentVersion),
				accept: "application/json",
			},
		},
		{
			maxRetries: options.retry ? 2 : 0,
			timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS,
		},
	);
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		packageName?: unknown;
		version?: unknown;
		note?: unknown;
	};
	if (typeof data.version !== "string" || !data.version.trim()) {
		return undefined;
	}
	const packageName =
		typeof data.packageName === "string" && data.packageName.trim() ? data.packageName.trim() : undefined;
	const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
	return {
		version: data.version.trim(),
		packageName,
		...(note ? { note } : {}),
	};
}

/** The newest Pi-Bolt version among GitHub's releases (pre-releases too; drafts never). */
export function newestPiBoltVersion(releases: unknown): string | undefined {
	if (!Array.isArray(releases)) return undefined;
	let newest: string | undefined;
	for (const release of releases as Array<{ tag_name?: unknown; draft?: unknown }>) {
		if (release?.draft === true) continue;
		const version = piBoltVersionOfTag(release?.tag_name);
		if (version && (!newest || (comparePackageVersions(version, newest) ?? 0) > 0)) newest = version;
	}
	return newest;
}

/**
 * Pi-Bolt updates as a whole (its Pi and its engine together), so a Pi-Bolt build looks at Pi-Bolt's releases, by Pi-Bolt
 * version: the latest release, or on the beta channel the newest, pre-releases included.
 */
async function getLatestPiBoltRelease(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean },
): Promise<LatestPiRelease | undefined> {
	const beta = piBoltChannel() === "beta";
	const response = await fetchWithRetry(
		beta ? PIBOLT_RELEASES_API : PIBOLT_LATEST_RELEASE_API,
		{ headers: { "User-Agent": getPiUserAgent(currentVersion), accept: "application/vnd.github+json" } },
		{ maxRetries: options.retry ? 2 : 0, timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS },
	);
	if (!response.ok) return undefined;
	const data = (await response.json()) as unknown;
	const version = beta ? newestPiBoltVersion(data) : piBoltVersionOfTag((data as { tag_name?: unknown }).tag_name);
	return version ? { version } : undefined;
}

export async function getLatestPiVersion(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<string | undefined> {
	return (await getLatestPiRelease(currentVersion, options))?.version;
}

export async function checkForNewPiVersion(currentVersion: string): Promise<LatestPiRelease | undefined> {
	if (process.env.PI_SKIP_VERSION_CHECK) return undefined;
	if (PIBOLT) currentVersion = PIBOLT.version;

	try {
		const latestRelease = await getLatestPiRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
