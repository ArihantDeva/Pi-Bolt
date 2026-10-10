import { describe, expect, it } from "vitest";
import { globToWindowsPathRegex } from "../src/core/tools/find.ts";

// What fd is given on Windows for a pattern with a "/" (find.ts adds the leading "**/").
function matches(glob: string, path: string): boolean {
	return new RegExp(globToWindowsPathRegex(glob)).test(path);
}

describe("globToWindowsPathRegex", () => {
	const root = "C:\\work\\project";
	it("lets ** span any number of folders, none included", () => {
		expect(matches("**/src/**/*.spec.ts", `${root}\\src\\y.spec.ts`)).toBe(true);
		expect(matches("**/src/**/*.spec.ts", `${root}\\src\\a\\b\\x.spec.ts`)).toBe(true);
		expect(matches("**/src/**/*.spec.ts", `${root}\\other\\z.spec.ts`)).toBe(false);
	});
	it("keeps * and ? within one name", () => {
		expect(matches("**/src/*.spec.ts", `${root}\\src\\y.spec.ts`)).toBe(true);
		expect(matches("**/src/*.spec.ts", `${root}\\src\\a\\b\\x.spec.ts`)).toBe(false);
		expect(matches("**/src/?.ts", `${root}\\src\\a.ts`)).toBe(true);
		expect(matches("**/src/?.ts", `${root}\\src\\ab.ts`)).toBe(false);
	});
	it("takes either separator, and the glob's classes and alternatives", () => {
		expect(matches("**/src/*.spec.ts", "C:/work/project/src/y.spec.ts")).toBe(true);
		expect(matches("**/src/*.{ts,tsx}", `${root}\\src\\view.tsx`)).toBe(true);
		expect(matches("**/src/*.{ts,tsx}", `${root}\\src\\view.js`)).toBe(false);
		expect(matches("**/src/[a-c]*.ts", `${root}\\src\\b.ts`)).toBe(true);
		expect(matches("**/src/[!a-c]*.ts", `${root}\\src\\b.ts`)).toBe(false);
	});
	it("escapes what is special in a regular expression", () => {
		expect(matches("**/a+b/(x).ts", `${root}\\a+b\\(x).ts`)).toBe(true);
		expect(matches("**/a.b/*.ts", `${root}\\aXb\\c.ts`)).toBe(false);
	});
	it("matches everything below for a trailing **", () => {
		expect(matches("**/src/**", `${root}\\src\\a\\b\\x.spec.ts`)).toBe(true);
		expect(matches("**/src/**", `${root}\\other\\x.ts`)).toBe(false);
	});
});
