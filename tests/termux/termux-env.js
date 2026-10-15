// For tests/termux/run.sh: what Pi-Bolt in Termux gives the programs it starts (Termux's LD_PRELOAD, back), its time zone, and
// that its event loop, timers and child processes work under Android's system call filter.
import { execFileSync, spawn } from "node:child_process";

export default function () {
	const sync = execFileSync(process.env.SHOW_PRELOAD, { encoding: "utf8" });
	const child = spawn(process.env.SHOW_PRELOAD, { stdio: ["ignore", "pipe", "inherit"] });
	let async = "";
	child.stdout.on("data", (data) => {
		async += data;
	});
	child.on("close", () => {
		setTimeout(() => {
			console.log(`termux-env: sync=${sync} async=${async} tz=${process.env.TZ ?? ""}`);
			process.exit(0);
		}, 20);
	});
}
