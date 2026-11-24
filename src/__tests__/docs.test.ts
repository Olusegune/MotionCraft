import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(__dirname, "../..");

/** Every relative link and picture in these documents must point at a file that exists, so the guide cannot drift from the repository. */
function links(file: string): { target: string; from: string }[] {
  const text = readFileSync(join(root, file), "utf-8");
  return [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((t) => !/^(https?:|mailto:)/.test(t)).map((t) => ({ target: t, from: file }));
}

describe("the documentation", () => {
  for (const file of ["README.md", "docs/USER_GUIDE.md"]) {
    it(`${file}: every relative link and picture exists`, () => {
      const missing = links(file).filter((l) => !existsSync(resolve(root, dirname(l.from), l.target))).map((l) => l.target);
      expect(missing).toEqual([]);
    });
  }

  it("the user guide has a picture for every step and states what is not verified", () => {
    const text = readFileSync(join(root, "docs/USER_GUIDE.md"), "utf-8");
    expect((text.match(/!\[[^\]]*\]\(guide\/[^)]+\)/g) ?? []).length).toBeGreaterThanOrEqual(11);
    expect(text).toMatch(/have not been run on a Mac/);
  });
});
