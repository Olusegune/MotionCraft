import { describe, expect, it } from "vitest";
import { friendlyWhen } from "../lib/when";

describe("friendlyWhen", () => {
  const now = new Date(2026, 10, 25, 18, 0, 0);
  it("says Today and Yesterday, then a short date", () => {
    expect(friendlyWhen(new Date(2026, 10, 25, 9, 5).toISOString(), now)).toMatch(/^Today, /);
    expect(friendlyWhen(new Date(2026, 10, 24, 23, 50).toISOString(), now)).toMatch(/^Yesterday, /);
    expect(friendlyWhen(new Date(2026, 9, 3, 12, 0).toISOString(), now)).toMatch(/Oct/);
    expect(friendlyWhen(new Date(2025, 9, 3, 12, 0).toISOString(), now)).toMatch(/2025/);
  });
  it("does not break on a bad date", () => { expect(friendlyWhen("nonsense", now)).toBe("an unknown time"); });
});
