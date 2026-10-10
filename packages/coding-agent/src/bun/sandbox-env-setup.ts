import { restoreSandboxEnv } from "./restore-sandbox-env.ts";

// Restore the environment before evaluating modules that read it at startup.
restoreSandboxEnv();

// Windows: a program named without a path is looked up on PATH only, never in the working directory first. Bun's spawn looks
// there unless this is set, and takes a .cmd there too, so a repository opened in Pi could have its own git.cmd or npm.cmd run
// for a bare `git` or `npm` (Pi's own calls, and extensions' pi.exec()). Programs started from here inherit it, so the shells
// the tools run (cmd.exe) do not look there either; a path such as .\build.cmd still runs what it names.
if (process.platform === "win32" && !process.env.NoDefaultCurrentDirectoryInExePath) {
	process.env.NoDefaultCurrentDirectoryInExePath = "1";
}
