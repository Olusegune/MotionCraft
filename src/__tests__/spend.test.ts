import { describe, expect, it } from "vitest";
import { createProject } from "../lib/project";
import { capBlock, recordSpend, spendLine, spendSummary } from "../lib/spend";

const log = (p: ReturnType<typeof createProject>, n: number, usd: number | null) => {
  let q = p;
  for (let i = 0; i < n; i++) q = recordSpend(q, { provider: "kie", model: "m", what: "still", usd });
  return q;
};

describe("spend ledger and limits", () => {
  it("counts calls and adds up only the prices that were known", () => {
    let p = log(createProject("x"), 2, 0.04);
    p = log(p, 1, null);
    expect(spendSummary(p)).toEqual({ calls: 3, knownUsd: 0.08, unknownCalls: 1 });
    expect(spendLine(p)).toBe("3 paid calls so far, $0.08 in known prices, 1 with no published price.");
    expect(spendLine(createProject("y"))).toBe("Nothing spent yet.");
  });

  it("blocks on the dollar limit when the price is known", () => {
    const p = log(createProject("x"), 1, 0.5);
    p.budget.capUsd = 1;
    expect(capBlock(p, 0.4)).toBeUndefined();
    expect(capBlock(p, 0.6)).toMatch(/over your \$1 limit/);
    expect(capBlock(p, 0.3, 3)).toMatch(/over your \$1 limit/);
  });

  it("blocks on the call limit when prices are unknown, so an unpriced aggregator cannot run away", () => {
    const p = log(createProject("x"), 25, null);
    expect(capBlock(p, null)).toMatch(/limit of 25 paid calls/);
    p.budget.maxCalls = 30;
    expect(capBlock(p, null)).toBeUndefined();
    expect(capBlock(p, null, 6)).toMatch(/limit of 30 paid calls/);
  });
});
