import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalBashOperations } from "../src/core/tools/bash.ts";
import { getDirectGitBash, getMsysBash, getShellConfig, getShellEnv } from "../src/utils/shell.ts";

function gitBash(): string | undefined {
	try {
		const { shell } = getShellConfig();
		return getMsysBash(shell) ? shell : undefined;
	} catch {
		return undefined;
	}
}

// Git Bash's runtime parses its own command line, and halved every doubled backslash of a command quoted the usual way.
describe.skipIf(process.platform !== "win32" || !gitBash())("the bash tool on Windows, with Git Bash", () => {
	it("passes the command to bash unchanged: backslashes, quotes, a heredoc", async () => {
		const text = String.raw`{"path": "C:\\Users\\x", "re": "\\d+", "unc": "\\\\srv\\share", "q": "\"", "end": "a\\"}`;
		let output = "";
		const { exitCode } = await createLocalBashOperations().exec(
			`cat <<'EOF'\n${text}\nEOF\nprintf '%s|' 'a\\\\b' "x\\"y"`,
			tmpdir(),
			{
				onData: (data: Buffer) => {
					output += data.toString();
				},
			},
		);
		expect(exitCode).toBe(0);
		expect(output).toBe(`${text}\na\\\\b|x"y|`);
	});

	it("starts Git's bash itself with what its launcher would have set", async () => {
		// (PATH up to the system's folders: a bash parameter expansion, written in two pieces for the linter.)
		const pathHead = `"$${"{"}PATH%%:/c/[Ww][Ii][Nn][Dd][Oo][Ww][Ss]*}"`;
		const probe = `printf "%s|%s|%s|%s" "$MSYSTEM" "$EXEPATH" "$PLINK_PROTOCOL" ${pathHead}`;
		const launcher = spawnSync(gitBash() as string, ["-c", probe], { encoding: "utf-8", env: getShellEnv() }).stdout;
		let output = "";
		await createLocalBashOperations().exec(probe, tmpdir(), {
			onData: (data: Buffer) => {
				output += data.toString();
			},
		});
		expect(getDirectGitBash(gitBash() as string)).toBeDefined();
		expect(output).toBe(launcher);
	});

	it("prefixes the PATH a child sees when an environment has both PATH and Path, and no relative home's bin", () => {
		const direct = getDirectGitBash(gitBash() as string);
		if (!direct) throw new Error("no direct Git bash");
		const both = direct.environment({ PATH: "C:\\seen", Path: "C:\\other", HOME: "rel\\home", USERPROFILE: "C:\\u" });
		const pathKeys = Object.keys(both).filter((key) => key.toUpperCase() === "PATH");
		expect(pathKeys).toEqual(["PATH"]);
		const entries = (both.PATH as string).split(";");
		expect(entries.at(-1)).toBe("C:\\seen");
		expect(entries.some((entry) => entry.toLowerCase().endsWith("\\usr\\bin"))).toBe(true);
		expect(entries.some((entry) => entry.startsWith("rel"))).toBe(false);
		const fromDrive = direct.environment({
			Path: "C:\\p",
			HOMEDRIVE: "C:",
			HOMEPATH: "\\Windows",
			USERPROFILE: "C:\\u",
		});
		expect((fromDrive.Path as string).split(";")).toContain("C:\\Windows\\bin");
	});
});

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

	it("refuses cmd.exe and PowerShell for shellPath, which ran nothing and reported success", () => {
		for (const shell of ["C:\\Windows\\System32\\cmd.exe", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"]) {
			expect(() => getShellConfig(shell)).toThrow(/not a bash/);
		}
	});

	it("uses WSL's launcher only when there is no other bash, reading the command from stdin", () => {
		const windowsApps = join(root, "local", "Microsoft", "WindowsApps");
		const wsl = place(join(windowsApps, "bash.exe"));
		process.env.PATH = windowsApps;
		expect(getShellConfig()).toEqual({ shell: wsl, args: ["-s"], commandTransport: "stdin" });
	});
});
