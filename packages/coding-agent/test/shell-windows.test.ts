import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getShellConfig } from "../src/utils/shell.ts";

// Which bash the shell tools use on Windows: Git Bash wherever Git for Windows is, before WSL's launchers on PATH.
describe.skipIf(process.platform !== "win32")("getShellConfig on Windows", () => {
	const saved = { ...process.env };
	let root: string;
	// Any small real executable: the lookup only checks that a file is there.
	const program = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe");
	function place(file: string): string {
		mkdirSync(join(file, ".."), { recursive: true });
		copyFileSync(program, file);
		return file;
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-shell-"));
		process.env.ProgramFiles = join(root, "no-program-files");
		process.env["ProgramFiles(x86)"] = join(root, "no-program-files-x86");
		process.env.LOCALAPPDATA = join(root, "local");
		process.env.USERPROFILE = join(root, "home");
	});
	afterEach(() => {
		for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
	});

	it("takes a portable Git's bash, found by its git.exe on PATH, over WSL's launcher earlier on PATH", () => {
		const windowsApps = join(root, "local", "Microsoft", "WindowsApps");
		place(join(windowsApps, "bash.exe"));
		place(join(root, "PortableGit", "cmd", "git.exe"));
		const bash = place(join(root, "PortableGit", "bin", "bash.exe"));
		process.env.PATH = [windowsApps, join(root, "PortableGit", "cmd")].join(";");
		expect(getShellConfig()).toEqual({ shell: bash, args: ["-c"] });
	});

	it("takes Git for Windows installed for the user (LOCALAPPDATA\\Programs\\Git)", () => {
		const bash = place(join(root, "local", "Programs", "Git", "bin", "bash.exe"));
		process.env.PATH = join(root, "empty");
		expect(getShellConfig().shell).toBe(bash);
	});

	it("uses WSL's launcher only when there is no other bash, reading the command from stdin", () => {
		const windowsApps = join(root, "local", "Microsoft", "WindowsApps");
		const wsl = place(join(windowsApps, "bash.exe"));
		process.env.PATH = windowsApps;
		expect(getShellConfig()).toEqual({ shell: wsl, args: ["-s"], commandTransport: "stdin" });
	});
});
