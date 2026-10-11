import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

// Pi-Bolt reads `piBolt.packages` in place of `packages`, which Pi keeps using: one agent directory, different packages per
// runtime. PIBOLT is only defined in a Pi-Bolt build, so the module is loaded again with its build constant set.
async function settingsManagerOf(build: string | undefined) {
	vi.resetModules();
	(globalThis as { PIBOLT_BUILD?: string }).PIBOLT_BUILD = build;
	const { SettingsManager } = await import("../src/core/settings-manager.ts");
	return SettingsManager;
}

function agentDirWith(settings: object): { cwd: string; agentDir: string; file: string } {
	const root = mkdtempSync(join(tmpdir(), "pibolt-settings-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	const file = join(agentDir, "settings.json");
	writeFileSync(file, JSON.stringify(settings, null, 2));
	return { cwd, agentDir, file };
}

afterEach(() => {
	delete (globalThis as { PIBOLT_BUILD?: string }).PIBOLT_BUILD;
	vi.resetModules();
});

describe("Pi-Bolt's own package list", () => {
	test("Pi-Bolt uses piBolt.packages, and writes its changes there", async () => {
		const SettingsManager = await settingsManagerOf("0.7.1 arm64 jit-off");
		const { cwd, agentDir, file } = agentDirWith({
			packages: ["npm:@juicesharp/rpiv-todo"],
			piBolt: { packages: ["npm:opensec-pi-todo"] },
		});
		const settings = SettingsManager.create(cwd, agentDir);
		expect(settings.getPackages()).toEqual(["npm:opensec-pi-todo"]);

		settings.setPackages(["npm:opensec-pi-todo", "npm:opensec-pi-subagents"]);
		await settings.flush();
		const written = JSON.parse(readFileSync(file, "utf8"));
		expect(written.piBolt.packages).toEqual(["npm:opensec-pi-todo", "npm:opensec-pi-subagents"]);
		expect(written.packages).toEqual(["npm:@juicesharp/rpiv-todo"]);
	});

	test("without piBolt.packages, Pi-Bolt uses packages as Pi does", async () => {
		const SettingsManager = await settingsManagerOf("0.7.1 arm64 jit-off");
		const { cwd, agentDir } = agentDirWith({ packages: ["npm:@juicesharp/rpiv-todo"] });
		expect(SettingsManager.create(cwd, agentDir).getPackages()).toEqual(["npm:@juicesharp/rpiv-todo"]);
	});

	test("Pi (not a Pi-Bolt build) ignores piBolt.packages", async () => {
		const SettingsManager = await settingsManagerOf(undefined);
		const { cwd, agentDir } = agentDirWith({
			packages: ["npm:@juicesharp/rpiv-todo"],
			piBolt: { packages: ["npm:opensec-pi-todo"] },
		});
		expect(SettingsManager.create(cwd, agentDir).getPackages()).toEqual(["npm:@juicesharp/rpiv-todo"]);
	});

	test("Pi-Bolt's first change makes its own list from Pi's, and leaves Pi's as it is", async () => {
		const SettingsManager = await settingsManagerOf("0.8.4 arm64 jit-off");
		const { cwd, agentDir, file } = agentDirWith({ packages: ["npm:pi-web-access"] });
		const settings = SettingsManager.create(cwd, agentDir);
		settings.setPackages(["npm:pi-web-access", "npm:another"]);
		await settings.flush();
		const written = JSON.parse(readFileSync(file, "utf8"));
		expect(written.packages).toEqual(["npm:pi-web-access"]);
		expect(written.piBolt.packages).toEqual(["npm:pi-web-access", "npm:another"]);
		expect(SettingsManager.create(cwd, agentDir).getPackagesKeptForPi("global")).toEqual(["npm:pi-web-access"]);
	});

	test("OpenSec's extensions, which Pi on Node cannot load, move out of Pi's list into Pi-Bolt's", async () => {
		const SettingsManager = await settingsManagerOf("0.8.4 arm64 jit-off");
		const before = [
			"npm:pi-web-access",
			"npm:opensec-pi-subagents@0.20.0",
			{ source: "npm:opensec-pi-todo@2.13.1" },
			"npm:opensec-pi-fff",
		];
		const { cwd, agentDir, file } = agentDirWith({ packages: before, theme: "dark" });
		expect(SettingsManager.create(cwd, agentDir).getPackages()).toEqual(before);
		const written = JSON.parse(readFileSync(file, "utf8"));
		expect(written.packages).toEqual(["npm:pi-web-access"]);
		expect(written.piBolt.packages).toEqual(before);
		expect(written.theme).toBe("dark");
	});

	test("with a list of its own already, they are added to it once", async () => {
		const SettingsManager = await settingsManagerOf("0.8.4 arm64 jit-off");
		const { cwd, agentDir, file } = agentDirWith({
			packages: ["npm:@juicesharp/rpiv-todo", "npm:opensec-pi-subagents@0.20.0", "npm:opensec-pi-todo@2.13.1"],
			piBolt: { packages: ["npm:opensec-pi-todo@2.13.1"] },
		});
		expect(SettingsManager.create(cwd, agentDir).getPackages()).toEqual([
			"npm:opensec-pi-todo@2.13.1",
			"npm:opensec-pi-subagents@0.20.0",
		]);
		const written = JSON.parse(readFileSync(file, "utf8"));
		expect(written.packages).toEqual(["npm:@juicesharp/rpiv-todo"]);
	});

	test("Pi (not a Pi-Bolt build) changes nothing, and writes packages as before", async () => {
		const SettingsManager = await settingsManagerOf(undefined);
		const before = ["npm:pi-web-access", "npm:opensec-pi-todo@2.13.1"];
		const { cwd, agentDir, file } = agentDirWith({ packages: before });
		const settings = SettingsManager.create(cwd, agentDir);
		expect(settings.getPackages()).toEqual(before);
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ packages: before });
		settings.setPackages(["npm:pi-web-access"]);
		await settings.flush();
		const written = JSON.parse(readFileSync(file, "utf8"));
		expect(written.packages).toEqual(["npm:pi-web-access"]);
		expect(written.piBolt).toBeUndefined();
	});
});
