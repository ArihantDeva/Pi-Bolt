// A program named without a path is found on PATH, never in the working directory: run.ps1 starts Pi in a folder that holds
// a pibolt-planted.cmd (which would write a marker file) and checks the marker is not there. A program on PATH still runs.
import { spawnSync } from "node:child_process";

export default function () {
	const planted = spawnSync("pibolt-planted", [], { encoding: "utf8" });
	const onPath = spawnSync("whoami", [], { encoding: "utf8" });
	console.log(
		`workdir-programs: planted=${planted.status === 0 ? "ran" : (planted.error?.code ?? planted.status)} whoami=${onPath.status === 0 && onPath.stdout.trim() ? "ok" : (onPath.error?.code ?? onPath.status)}`,
	);
	process.exit(0);
}
