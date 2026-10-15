import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CONFIG_DIR_NAME, ENV_AGENT_DIR } from "../src/config.ts";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import {
	InMemorySettingsStorage,
	type PackageSource,
	type Settings,
	SettingsManager,
} from "../src/core/settings-manager.ts";
import { main } from "../src/main.ts";
import { ConfigSelectorComponent } from "../src/modes/interactive/components/config-selector.ts";
import { handlePackageCommand } from "../src/package-manager-cli.ts";
import { allowNetwork } from "./test-network-env.ts";

const build = vi.hoisted(() => ({ piBolt: true }));
vi.mock("../src/pi-bolt.ts", async (importOriginal) => ({
	...(await importOriginal<object>()),
	get PIBOLT() {
		return build.piBolt ? { version: "0.8.4", variant: "arm64", jit: false } : undefined;
	},
}));

let root: string;
let agentDir: string;
let cwd: string;
let globalFile: string;
let projectFile: string;
let originalCwd: string;
let originalExitCode: typeof process.exitCode;

function writeSettings(global: Settings, project?: Settings): void {
	writeFileSync(globalFile, JSON.stringify(global));
	if (project) writeFileSync(projectFile, JSON.stringify(project));
}

function readSettings(file = globalFile): Settings {
	return JSON.parse(readFileSync(file, "utf8")) as Settings;
}

function manager(projectTrusted = true) {
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted });
	return { settings, packages: new DefaultPackageManager({ cwd, agentDir, settingsManager: settings }) };
}

function localPackage(name: string): string {
	const path = join(root, name);
	mkdirSync(join(path, "extensions"), { recursive: true });
	writeFileSync(
		join(path, "package.json"),
		JSON.stringify({ name, version: "1.0.0", pi: { extensions: ["extensions/*.ts"] } }),
	);
	writeFileSync(join(path, "extensions", "a.ts"), "export default () => {};");
	writeFileSync(join(path, "extensions", "b.ts"), "export default () => {};");
	return path;
}

function installedNpm(name: string, local = false): string {
	const path = join(local ? join(cwd, CONFIG_DIR_NAME) : agentDir, "npm", "node_modules", name);
	mkdirSync(join(path, "extensions"), { recursive: true });
	writeFileSync(
		join(path, "package.json"),
		JSON.stringify({ name, version: "1.0.0", pi: { extensions: ["extensions/a.ts"] } }),
	);
	writeFileSync(join(path, "extensions", "a.ts"), "export default () => {};");
	return path;
}

beforeEach(() => {
	build.piBolt = true;
	root = realpathSync(mkdtempSync(join(tmpdir(), "pibolt-packages-")));
	agentDir = join(root, "agent");
	cwd = join(root, "project");
	mkdirSync(agentDir);
	mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
	globalFile = join(agentDir, "settings.json");
	projectFile = join(cwd, CONFIG_DIR_NAME, "settings.json");
	originalCwd = process.cwd();
	originalExitCode = process.exitCode;
	process.exitCode = undefined;
	process.chdir(cwd);
	vi.stubEnv(ENV_AGENT_DIR, agentDir);
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
	process.chdir(originalCwd);
	process.exitCode = originalExitCode;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

// #28: exercise raw settings, the real resolver, configuration writes and CLI dispatch without network installs.
describe("Pi-Bolt additive package inheritance", () => {
	test("ordinary install/remove edits shared packages, and later shared changes remain visible", async () => {
		const shared = localPackage("shared");
		const own = localPackage("own");
		const later = localPackage("later");
		writeSettings({ packages: [shared], piBolt: { packages: [own] } });
		const { settings, packages } = manager();
		await packages.installAndPersist(later);
		await settings.flush();
		expect(readSettings().packages).toEqual([shared, relative(agentDir, later)]);
		expect(readSettings().piBolt?.packages).toEqual([own]);
		expect(packages.listConfiguredPackages().map((entry) => entry.source)).toEqual([
			shared,
			relative(agentDir, later),
			own,
		]);
		expect((await packages.resolve()).extensions).toHaveLength(6);
		expect(await packages.removeAndPersist(later)).toBe(true);
		await settings.flush();
		expect(readSettings().packages).toEqual([shared]);
		expect(readSettings().piBolt?.packages).toEqual([own]);
	});

	test("first explicit install writes only its addition, not a snapshot of shared packages", async () => {
		const shared = localPackage("shared");
		const own = localPackage("own");
		writeSettings({ packages: [shared] });
		const { settings, packages } = manager();
		await packages.installAndPersist(own, { piBolt: true });
		await settings.flush();
		expect(readSettings().packages).toEqual([shared]);
		expect(readSettings().piBolt?.packages).toEqual([relative(agentDir, own)]);
		writeSettings({ ...readSettings(), packages: [shared, localPackage("new-shared")] });
		await settings.reload();
		expect((await packages.resolve()).extensions).toHaveLength(6);
	});

	test("empty overlays inherit and empty project packages do not disable global resolution", async () => {
		const shared = localPackage("shared");
		writeSettings({ packages: [shared], piBolt: { packages: [] } }, { packages: [], piBolt: { packages: [] } });
		const { settings, packages } = manager();
		expect(settings.getResolvedPackages("global")).toEqual([shared]);
		expect((await packages.resolve()).extensions).toHaveLength(2);
		expect(packages.listConfiguredPackages().map((entry) => entry.source)).toEqual([shared]);
	});

	test("same-identity npm, git and normalized local entries replace shared entries with filters intact", async () => {
		const local = localPackage("local");
		const overrides: PackageSource[] = [
			{ source: "npm:@scope/tools@2.0.0", extensions: [] },
			{ source: "git:git@github.com:example/tools.git@next", skills: ["selected"] },
			{ source: relative(agentDir, local), extensions: ["-extensions/a.ts"] },
		];
		writeSettings({
			packages: ["npm:@scope/tools@1.0.0", "https://github.com/example/tools@main", `${local}/../local/`],
			piBolt: { packages: overrides },
		});
		const { settings } = manager();
		expect(settings.getPackages()).toEqual(overrides);
		expect(settings.getGlobalSettings().packages).toHaveLength(3);
		expect(settings.getSettings().packages).toEqual(readSettings().packages);
		settings.setPackages(["npm:new-shared"]);
		settings.setPackages(overrides, { piBolt: true });
		await settings.flush();
		expect(readSettings()).toEqual({ packages: ["npm:new-shared"], piBolt: { packages: overrides } });
	});

	test("exclusion plus different-name addition replaces a package; exclusions never resolve as sources", async () => {
		const original = localPackage("original");
		const replacement = localPackage("replacement");
		const retained = localPackage("retained");
		writeSettings({ packages: [original, retained], piBolt: { packages: [`-${original}`, replacement] } });
		const { packages } = manager();
		const missing = vi.fn(async () => {
			throw new Error("unexpected install");
		});
		const resolved = await packages.resolve(missing);
		expect(resolved.extensions).toHaveLength(4);
		expect(
			resolved.extensions.every(
				(entry) => entry.metadata.source !== original && !entry.metadata.source.startsWith("-"),
			),
		).toBe(true);
		expect(missing).not.toHaveBeenCalled();
		expect(packages.listConfiguredPackages().map((entry) => entry.source)).toEqual([retained, replacement]);
	});

	test("trusted project overlays keep scope, filters and project precedence; exclusion falls back to global", async () => {
		installedNpm("tools");
		installedNpm("tools", true);
		writeSettings(
			{ packages: ["npm:tools"] },
			{ packages: ["npm:tools"], piBolt: { packages: [{ source: "npm:tools@1.0.0", extensions: [] }] } },
		);
		const { settings, packages } = manager(false);
		expect((await packages.resolve()).extensions.map((entry) => [entry.enabled, entry.metadata.scope])).toEqual([
			[true, "user"],
		]);
		expect(() => settings.setProjectPackages([], { piBolt: true })).toThrow("not trusted");
		await expect(packages.installAndPersist("npm:tools", { local: true, piBolt: true })).rejects.toThrow(
			"not trusted",
		);
		settings.setProjectTrusted(true);
		expect((await packages.resolve()).extensions.map((entry) => [entry.enabled, entry.metadata.scope])).toEqual([
			[false, "project"],
		]);
		settings.setProjectPackages(["-npm:tools"], { piBolt: true });
		await settings.flush();
		expect((await packages.resolve()).extensions.map((entry) => [entry.enabled, entry.metadata.scope])).toEqual([
			[true, "user"],
		]);
		expect(readSettings(projectFile).packages).toEqual(["npm:tools"]);
	});

	test("project autoload deltas still apply over global package filters", async () => {
		installedNpm("tools");
		writeSettings(
			{ packages: ["npm:tools"] },
			{ piBolt: { packages: [{ source: "npm:tools", autoload: false, extensions: ["-extensions/a.ts"] }] } },
		);
		const { packages } = manager();
		expect((await packages.resolve()).extensions.map((entry) => [entry.enabled, entry.metadata.scope])).toEqual([
			[false, "project"],
		]);
	});

	test("removing an inherited or overridden package excludes it only for Pi-Bolt, and install re-enables it", async () => {
		const shared = localPackage("shared");
		writeSettings({ packages: [shared] });
		const { settings, packages } = manager();
		expect(await packages.removeAndPersist(shared, { piBolt: true })).toBe(true);
		await settings.flush();
		expect(readSettings()).toEqual({ packages: [shared], piBolt: { packages: [`-${shared}`] } });
		expect((await packages.resolve()).extensions).toHaveLength(0);
		expect(packages.removeSourceFromSettings(shared, { piBolt: true })).toBe(false);
		await packages.installAndPersist(shared, { piBolt: true });
		await settings.flush();
		expect(settings.getPackages()).toEqual([relative(agentDir, shared)]);
		expect(readSettings().piBolt?.packages).toEqual([relative(agentDir, shared)]);
		expect(await packages.removeAndPersist(shared, { piBolt: true })).toBe(true);
		await settings.flush();
		expect(readSettings().piBolt?.packages).toEqual([`-${shared}`]);
	});

	test.each([false, true])("physical npm removal retains files used by the other list (local=%s)", async (local) => {
		const installed = installedNpm("tools", local);
		writeSettings(
			local ? {} : { packages: ["npm:tools"], piBolt: { packages: ["npm:tools@1.0.0"] } },
			local ? { packages: ["npm:tools"], piBolt: { packages: ["npm:tools@1.0.0"] } } : undefined,
		);
		const { settings, packages } = manager();
		expect(await packages.removeAndPersist("npm:tools", { local })).toBe(true);
		await settings.flush();
		expect(existsSync(installed)).toBe(true);
		expect(settings.getResolvedPackages(local ? "project" : "global")).toEqual(["npm:tools@1.0.0"]);
		if (local) settings.setProjectPackages(["npm:tools"]);
		else settings.setPackages(["npm:tools"]);
		await settings.flush();
		expect(await packages.removeAndPersist("npm:tools", { local, piBolt: true })).toBe(true);
		await settings.flush();
		expect(existsSync(installed)).toBe(true);
		expect(settings.getResolvedPackages(local ? "project" : "global")).toEqual([]);
	});

	test("physical git removal keeps shared files, but deletes an unshared explicit install", async () => {
		const source = "git:github.com/example/tools";
		const path = join(agentDir, "git", "github.com", "example", "tools");
		mkdirSync(path, { recursive: true });
		writeSettings({ packages: [source] });
		const { settings, packages } = manager();
		await packages.removeAndPersist(source, { piBolt: true });
		await settings.flush();
		expect(existsSync(path)).toBe(true);
		settings.setPackages([]);
		settings.setPackages([source], { piBolt: true });
		await settings.flush();
		await packages.removeAndPersist(source, { piBolt: true });
		await settings.flush();
		expect(existsSync(path)).toBe(false);
	});

	test("reload observes overlay deletion, settings deletion and later shared changes without copying", async () => {
		const shared = localPackage("shared");
		const own = localPackage("own");
		writeSettings({ packages: [shared], piBolt: { packages: [own] } });
		const { settings, packages } = manager();
		expect((await packages.resolve()).extensions).toHaveLength(4);
		writeSettings({ packages: [shared] });
		await settings.reload();
		expect((await packages.resolve()).extensions).toHaveLength(2);
		rmSync(globalFile);
		await settings.reload();
		expect(packages.listConfiguredPackages()).toEqual([]);
		settings.setPackages([own], { piBolt: true });
		await settings.flush();
		expect(readSettings()).toEqual({ piBolt: { packages: [own] } });
	});

	test("safety migration moves only historical Bun-only extensions, once, preserving object filters", async () => {
		const shared = "npm:ordinary";
		const bunOnly = { source: "npm:opensec-pi-todo@2.13.1", skills: [] };
		writeSettings({ packages: [shared, bunOnly], theme: "dark" });
		const { settings } = manager();
		expect(settings.getPackages()).toEqual([shared, bunOnly]);
		expect(readSettings()).toEqual({ packages: [shared], piBolt: { packages: [bunOnly] }, theme: "dark" });
		await settings.reload();
		expect(readSettings().piBolt?.packages).toEqual([bunOnly]);
	});

	test("stock Pi ignores additive lists and writes shared declarations unchanged", async () => {
		build.piBolt = false;
		const shared = localPackage("shared");
		const own = localPackage("own");
		writeSettings({ packages: [shared], piBolt: { packages: [`-${shared}`, own] } });
		const { settings, packages } = manager();
		expect(settings.getPackages()).toEqual([shared]);
		expect((await packages.resolve()).extensions).toHaveLength(2);
		await packages.installAndPersist(own);
		await settings.flush();
		expect(readSettings().packages).toEqual([shared, relative(agentDir, own)]);
		expect(readSettings().piBolt?.packages).toEqual([`-${shared}`, own]);
		expect(() => settings.setPackages([], { piBolt: true })).toThrow("Pi-Bolt build");
	});

	test("config selector updates shared and explicit declaration filters without copying other packages", async () => {
		const shared = localPackage("shared");
		const own = localPackage("own");
		writeSettings({
			packages: [{ source: shared, skills: [] }],
			piBolt: { packages: [{ source: own, themes: [] }] },
		});
		const { settings, packages } = manager();
		const resolved = await packages.resolve();
		for (const [source, piBolt] of [
			[shared, false],
			[own, true],
		] as const) {
			const paths = {
				...resolved,
				extensions: resolved.extensions.filter((entry) => entry.metadata.source === source),
			};
			const selector = new ConfigSelectorComponent(
				{ global: paths, project: paths },
				settings,
				cwd,
				agentDir,
				() => {},
				() => {},
				() => {},
			);
			selector.getResourceList().handleInput(" ");
			await settings.flush();
			const written = readSettings();
			expect(written.packages).toHaveLength(1);
			expect(written.piBolt?.packages).toHaveLength(1);
			const entry = (piBolt ? written.piBolt?.packages : written.packages)?.[0];
			expect(entry).toMatchObject({ source, extensions: ["-extensions/a.ts"] });
		}
		expect(readSettings().packages?.[0]).toMatchObject({ skills: [] });
		expect(readSettings().piBolt?.packages?.[0]).toMatchObject({ themes: [] });
	});

	// #28: SDK raw lists and runtime-only overrides must remain distinct.
	test.each([false, true])(
		"SDK getPackages keeps project precedence and applyOverrides without persisting it (Pi-Bolt=%s)",
		async (piBolt) => {
			build.piBolt = piBolt;
			writeSettings(
				{ packages: ["npm:global"], piBolt: { packages: ["npm:global-own"] } },
				{ packages: ["npm:project"], piBolt: { packages: ["npm:project-own"] } },
			);
			const { settings } = manager();
			expect(settings.getPackages()).toEqual(piBolt ? ["npm:project", "npm:project-own"] : ["npm:project"]);
			settings.applyOverrides({ packages: ["npm:runtime"] });
			expect(settings.getPackages()).toEqual(piBolt ? ["npm:runtime", "npm:project-own"] : ["npm:runtime"]);
			expect(settings.getResolvedPackages("project")).toEqual(
				piBolt ? ["npm:project", "npm:project-own"] : ["npm:project"],
			);
			settings.setTheme("dark");
			await settings.flush();
			expect(settings.getPackages()).toEqual(piBolt ? ["npm:project", "npm:project-own"] : ["npm:project"]);
			expect(readSettings(projectFile).packages).toEqual(["npm:project"]);
		},
	);

	// #28: custom storage has no file paths; the actual package manager supplies its settings base directories.
	test("SDK inMemory and fromStorage resolve relative overrides against custom manager paths", async () => {
		const local = localPackage("local");
		const customAgentDir = join(root, "custom", "nested-agent");
		mkdirSync(customAgentDir, { recursive: true });
		const raw = {
			packages: [local],
			piBolt: { packages: [{ source: relative(customAgentDir, local), extensions: [] }] },
		};
		const storage = new InMemorySettingsStorage();
		storage.withLock("global", () => JSON.stringify(raw));
		for (const settings of [SettingsManager.inMemory(raw), SettingsManager.fromStorage(storage)]) {
			const packages = new DefaultPackageManager({ cwd, agentDir: customAgentDir, settingsManager: settings });
			expect(settings.getResolvedPackages("global", customAgentDir)).toEqual(raw.piBolt.packages);
			expect(packages.listConfiguredPackages()).toHaveLength(1);
			expect((await packages.resolve()).extensions.map((entry) => entry.enabled)).toEqual([false, false]);
		}
	});

	// #28: update and update checks consume overlays, never exclusions or shadowed declarations.
	test("update/check-update use inherited additions, replacements and exclusions with transport mocked", async () => {
		allowNetwork();
		for (const name of ["shared", "excluded", "replaced", "own"]) installedNpm(name);
		writeSettings({
			packages: ["npm:shared", "npm:excluded", "npm:replaced@1"],
			piBolt: { packages: ["-npm:excluded", "npm:replaced@^2", "npm:own"] },
		});
		const { packages } = manager();
		const transport = packages as unknown as {
			runCommandCapture(command: string, args: string[]): Promise<string>;
			runCommand(command: string, args: string[]): Promise<void>;
		};
		const capture = vi.spyOn(transport, "runCommandCapture").mockResolvedValue('"2.0.0"');
		const command = vi.spyOn(transport, "runCommand").mockResolvedValue();
		expect((await packages.checkForAvailableUpdates()).map((entry) => entry.source)).toEqual([
			"npm:shared",
			"npm:replaced@^2",
			"npm:own",
		]);
		await packages.update();
		expect(capture.mock.calls.every(([, args]) => args[1] !== "excluded" && args[1] !== "replaced@1")).toBe(true);
		expect(command).toHaveBeenCalledWith(
			"npm",
			[
				"install",
				"shared@latest",
				"replaced@^2",
				"own@latest",
				"--prefix",
				join(agentDir, "npm"),
				"--legacy-peer-deps",
			],
			undefined,
		);
		await expect(packages.update("npm:excluded")).rejects.toThrow("No matching package");
		expect(readSettings().piBolt?.packages).toEqual(["-npm:excluded", "npm:replaced@^2", "npm:own"]);
	});

	// #28: project selector writes follow the raw owner and keep project/global delta precedence.
	test("project config selector edits Pi-Bolt declarations and cycles inherited Pi-Bolt deltas", async () => {
		const own = localPackage("own");
		writeSettings({ piBolt: { packages: [own] } }, { piBolt: { packages: [] } });
		const { settings, packages } = manager();
		const resolved = await packages.resolve();
		const selector = new ConfigSelectorComponent(
			{ global: resolved, project: resolved },
			settings,
			cwd,
			agentDir,
			() => {},
			() => {},
			() => {},
			24,
			"project",
		);
		selector.getResourceList().handleInput(" ");
		await settings.flush();
		expect(readSettings(projectFile).packages).toBeUndefined();
		expect(readSettings(projectFile).piBolt?.packages).toEqual([
			{ source: relative(join(cwd, CONFIG_DIR_NAME), own), autoload: false, extensions: ["-extensions/a.ts"] },
		]);
		expect((await packages.resolve()).extensions.map((entry) => entry.enabled)).toEqual([false, true]);
		selector.getResourceList().handleInput(" ");
		selector.getResourceList().handleInput(" ");
		await settings.flush();
		expect(readSettings(projectFile).piBolt?.packages).toEqual([]);
		expect(readSettings().piBolt?.packages).toEqual([own]);
	});

	// #28: modifiers are ordered and normal entries replace an identity exactly once.
	test.each([
		{ entries: ["npm:tools@^1", "-npm:tools"], expected: [] },
		{ entries: ["-npm:tools", "npm:tools@^1"], expected: ["npm:tools@^1"] },
		{ entries: ["npm:tools@^1", "npm:tools@~1.0.0"], expected: ["npm:tools@~1.0.0"] },
	])("applies overlay entries in order: $entries", async ({ entries, expected }) => {
		installedNpm("tools");
		writeSettings({ packages: ["npm:tools"], piBolt: { packages: entries } });
		const { settings, packages } = manager();
		expect(settings.getPackages()).toEqual(expected);
		expect(packages.listConfiguredPackages().map((entry) => entry.source)).toEqual(expected);
		expect((await packages.resolve()).extensions).toHaveLength(expected.length);
	});

	// #28: migrations must not override a user's newer source or exclusion.
	test.each(["npm:opensec-pi-todo@3.0.0", "-npm:opensec-pi-todo"])(
		"safety migration respects existing identity override %s",
		(entry) => {
			writeSettings({ packages: ["npm:ordinary", "npm:opensec-pi-todo@2.13.1"], piBolt: { packages: [entry] } });
			const { settings } = manager();
			expect(readSettings()).toEqual({ packages: ["npm:ordinary"], piBolt: { packages: [entry] } });
			expect(settings.getPackages()).toEqual(entry.startsWith("-") ? ["npm:ordinary"] : ["npm:ordinary", entry]);
		},
	);

	// #28: stock Pi never uses the Pi-Bolt declarations to retain files during removal.
	test("stock Pi removal ignores Pi-Bolt declarations", async () => {
		build.piBolt = false;
		const source = "git:github.com/example/tools";
		const installed = join(agentDir, "git", "github.com", "example", "tools");
		mkdirSync(installed, { recursive: true });
		writeSettings({ packages: [source], piBolt: { packages: [source] } });
		const { settings, packages } = manager();
		expect(await packages.removeAndPersist(source)).toBe(true);
		await settings.flush();
		expect(existsSync(installed)).toBe(false);
		expect(readSettings()).toEqual({ packages: [], piBolt: { packages: [source] } });
	});

	// #28: retain tolerance for non-array overlays in every new consumer, without validating shared entries.
	test.each(["bad", null, 1, {}])(
		"ignores malformed Pi-Bolt package list %j and explicit install normalizes it",
		async (malformed) => {
			const shared = localPackage("shared");
			const own = localPackage("own");
			writeFileSync(globalFile, JSON.stringify({ packages: [shared], piBolt: { packages: malformed } }));
			writeFileSync(projectFile, JSON.stringify({ piBolt: { packages: malformed } }));
			const { settings, packages } = manager();
			expect(settings.getPackages()).toEqual([shared]);
			expect(packages.listConfiguredPackages()).toHaveLength(1);
			const resolved = await packages.resolve();
			expect(resolved.extensions).toHaveLength(2);
			const selector = new ConfigSelectorComponent(
				{ global: resolved, project: resolved },
				settings,
				cwd,
				agentDir,
				() => {},
				() => {},
				() => {},
			);
			selector.getResourceList().handleInput(" ");
			await settings.flush();
			expect(readSettings().piBolt?.packages).toEqual(malformed);
			await packages.installAndPersist(own);
			await packages.removeAndPersist(own);
			await settings.flush();
			expect(readSettings().piBolt?.packages).toEqual(malformed);
			await packages.installAndPersist(own, { piBolt: true });
			await settings.flush();
			expect(readSettings().piBolt?.packages).toEqual([relative(agentDir, own)]);
		},
	);

	// #28: controlling a global fallback must not edit the project declaration hidden by its own exclusion.
	test("project config toggles global fallback over an exclusion and restores that exclusion on inherit", async () => {
		installedNpm("tools");
		installedNpm("tools", true);
		const unrelated = localPackage("unrelated");
		const projectShared = [{ source: "npm:tools", extensions: [] }];
		const projectOwn = ["-npm:tools", unrelated];
		writeSettings({ packages: ["npm:tools"] }, { packages: projectShared, piBolt: { packages: projectOwn } });
		const { settings, packages } = manager();
		const globalPaths = await manager(false).packages.resolve();
		const resolved = await packages.resolve();
		const projectPaths = {
			...resolved,
			extensions: resolved.extensions.filter((entry) => entry.metadata.source === "npm:tools"),
		};
		const selector = new ConfigSelectorComponent(
			{ global: globalPaths, project: projectPaths },
			settings,
			cwd,
			agentDir,
			() => {},
			() => {},
			() => {},
			24,
			"project",
		);
		for (const expectedEnabled of [false, true, true]) {
			selector.getResourceList().handleInput(" ");
			await settings.flush();
			const toolResources = (await packages.resolve()).extensions.filter(
				(entry) => entry.metadata.source === "npm:tools",
			);
			expect(toolResources.map((entry) => entry.enabled)).toEqual([expectedEnabled]);
			expect(readSettings(projectFile).packages).toEqual(projectShared);
			expect(readSettings(projectFile).piBolt?.packages?.slice(0, 2)).toEqual(projectOwn);
		}
		expect(readSettings(projectFile).piBolt?.packages).toEqual(projectOwn);
		expect(readSettings().packages).toEqual(["npm:tools"]);
	});
});

// #28: CLI tests use real handlers and local package fixtures, including rejection before settings migrations.
describe("package CLI --pi-bolt", () => {
	test.each([false, true])("install/remove select Pi-Bolt list explicitly (local=%s)", async (local) => {
		const shared = localPackage("shared");
		const own = localPackage("own");
		writeSettings({ packages: [shared] }, { packages: [shared] });
		const scopeFlags = local ? ["--local", "--approve"] : [];
		await handlePackageCommand(["install", own, "--pi-bolt", ...scopeFlags]);
		expect(process.exitCode).toBeUndefined();
		const file = local ? projectFile : globalFile;
		const baseDir = local ? join(cwd, CONFIG_DIR_NAME) : agentDir;
		expect(readSettings(file)).toEqual({ packages: [shared], piBolt: { packages: [relative(baseDir, own)] } });
		await handlePackageCommand(["uninstall", own, "--pi-bolt", ...scopeFlags]);
		expect(readSettings(file)).toEqual({ packages: [shared], piBolt: { packages: [] } });
		await handlePackageCommand(["remove", shared, "--pi-bolt", ...scopeFlags]);
		expect(readSettings(file).piBolt?.packages).toEqual([`-${shared}`]);
	});

	test("ordinary CLI install writes shared packages even after an override exists", async () => {
		const own = localPackage("own");
		const shared = localPackage("shared");
		writeSettings({ piBolt: { packages: [own] } });
		await handlePackageCommand(["install", shared]);
		expect(readSettings()).toEqual({ packages: [relative(agentDir, shared)], piBolt: { packages: [own] } });
	});

	test("untrusted --local --pi-bolt is rejected without project writes", async () => {
		writeSettings({}, { piBolt: { packages: [] } });
		await handlePackageCommand(["install", localPackage("own"), "--pi-bolt", "--local", "--no-approve"]);
		expect(process.exitCode).toBe(1);
		expect(readSettings(projectFile)).toEqual({ piBolt: { packages: [] } });
	});

	test.each(["list", "update", "config", "mcp", "auth", "--print"])(
		"rejects unsupported %s before settings migration or runtime startup",
		async (command) => {
			writeSettings({ packages: ["npm:opensec-pi-todo"] });
			const before = readFileSync(globalFile, "utf8");
			await main([command, "--pi-bolt"]);
			expect(process.exitCode).toBe(1);
			expect(readFileSync(globalFile, "utf8")).toBe(before);
			expect(existsSync(join(agentDir, "sessions"))).toBe(false);
		},
	);

	test("stock Pi rejects --pi-bolt before installs, settings writes or help dispatch", async () => {
		build.piBolt = false;
		for (const args of [
			["install", "npm:tools", "--pi-bolt"],
			["remove", "npm:tools", "--pi-bolt"],
			["install", "--help", "--pi-bolt"],
		]) {
			process.exitCode = undefined;
			await main(args);
			expect(process.exitCode).toBe(1);
			expect(existsSync(globalFile)).toBe(false);
			expect(existsSync(join(agentDir, "npm"))).toBe(false);
		}
	});

	// #28: an explicit install re-enables an identity despite duplicate manual modifiers and retains its filters.
	test("install --pi-bolt removes all same-identity modifiers before enabling the source", async () => {
		const shared = localPackage("shared");
		writeSettings({
			packages: [shared],
			piBolt: { packages: [shared, `-${shared}`, { source: shared, skills: [] }, `-${shared}`] },
		});
		await handlePackageCommand(["install", shared, "--pi-bolt"]);
		expect(process.exitCode).toBeUndefined();
		expect(readSettings()).toEqual({
			packages: [shared],
			piBolt: { packages: [{ source: relative(agentDir, shared), skills: [] }] },
		});
		expect((await manager().packages.resolve()).extensions).toHaveLength(2);
		await handlePackageCommand(["remove", shared, "--pi-bolt"]);
		expect(readSettings().piBolt?.packages).toEqual([`-${shared}`]);
	});

	// #28: validate every flag occurrence before any migration or installation.
	test.each([{ flags: ["--pi-bolt", "--pi-bolt=true"] }, { flags: ["--pi-bolt=false", "--pi-bolt"] }])(
		"rejects malformed repeated selectors: $flags",
		async ({ flags }) => {
			writeSettings({ packages: ["npm:opensec-pi-todo"] });
			const before = readFileSync(globalFile, "utf8");
			await main(["install", "npm:tools", ...flags]);
			expect(process.exitCode).toBe(1);
			expect(readFileSync(globalFile, "utf8")).toBe(before);
			expect(existsSync(join(agentDir, "npm"))).toBe(false);
		},
	);
});
