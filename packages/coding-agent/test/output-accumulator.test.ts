import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as OutputFiles from "../src/utils/output-files.ts";

const scratch = mkdtempSync(join(tmpdir(), "pi-output-accumulator-"));

// The full output file with a size limit of 1000 bytes, as the real one is past 1 GiB.
vi.mock("../src/utils/output-files.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof OutputFiles>();
	let files = 0;
	return {
		...actual,
		createOutputFile: () => new actual.OutputFile(join(scratch, `out-${files++}.log`), 1000),
	};
});

import { OutputAccumulator } from "../src/core/tools/output-accumulator.ts";

describe("OutputAccumulator.readFullOutput", () => {
	afterEach(() => {
		rmSync(scratch, { recursive: true, force: true });
	});

	it("ends with the output's real end when the full output file reached its size limit", async () => {
		const output = new OutputAccumulator({ maxBytes: 100 });
		output.append(Buffer.from("first line\n"));
		for (let i = 0; i < 30; i++) output.append(Buffer.from(`${"y".repeat(99)}\n`));
		output.append(Buffer.from("TESTS: 3 failed\n"));
		output.finish();
		output.closeTempFile();

		const full = await output.readFullOutput(200);

		expect(full.truncated).toBe(true);
		const [head, omitted, tail] = full.content.split(/\n\n\[\.\.\. (\d+) bytes omitted \.\.\.\]\n\n/);
		expect(head.startsWith("first line\n")).toBe(true);
		expect(tail).toMatch(/TESTS: 3 failed\n?$/);
		expect(full.content).not.toContain("was not saved");
		// Of all the output, not of the file.
		expect(Number(omitted)).toBe(11 + 30 * 100 + 16 - head.length - tail.length);
	});
});
