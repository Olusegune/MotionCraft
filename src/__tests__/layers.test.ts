import { describe, expect, it } from "vitest";
import { approveLayer, isChangedSinceApproval, reconcile, unlockLayer, type EngineLayer, type EngineSnapshot } from "../lib/layers";
import { createProject } from "../lib/project";

const layer = (id: number, hash: string, extra: Partial<EngineLayer> = {}): EngineLayer =>
  ({ id, name: `L${id}`, kind: "Text", index: 1, parent: null, nativeLocked: false, approvedHere: false, hash, ...extra });
const snap = (...layers: EngineLayer[]): EngineSnapshot => ({ path: null, dirty: false, activeComp: 1, comps: [], layers });

describe("layer bindings and drift", () => {
  it("binds new layers and records no revision for them", () => {
    const p = reconcile(createProject("T"), snap(layer(2, "a")));
    expect(p.layerMap).toHaveLength(1);
    expect(p.layerMap![0].lastKnownHash).toBe("a");
    expect(p.revisions).toHaveLength(0);
  });

  it("logs a changed hash once as a user revision and never reverts it", () => {
    let p = reconcile(createProject("T"), snap(layer(2, "a")));
    p = reconcile(p, snap(layer(2, "b")));
    expect(p.revisions).toHaveLength(1);
    expect(p.revisions[0]).toMatchObject({ actor: "user", kind: "manual_edit", layers: [2] });
    expect(p.layerMap![0].lastKnownHash).toBe("b");
    const again = reconcile(p, snap(layer(2, "b")));
    expect(again.revisions).toHaveLength(1);
  });

  it("takes our own writes silently", () => {
    let p = reconcile(createProject("T"), snap(layer(2, "a")));
    p = reconcile(p, snap(layer(2, "b")), [2]);
    expect(p.revisions).toHaveLength(0);
    expect(p.layerMap![0].lastKnownHash).toBe("b");
  });

  it("flags an approved layer that was edited in EffectCraft", () => {
    let p = reconcile(createProject("T"), snap(layer(2, "a")));
    p = approveLayer(p, layer(2, "a"));
    expect(p.layerMap![0]).toMatchObject({ lock: "approved", approvedHash: "a" });
    p = reconcile(p, snap(layer(2, "z", { approvedHere: true })));
    expect(p.approvals.at(-1)).toMatchObject({ gate: "layer", state: "changed_by_user" });
    expect(isChangedSinceApproval(p, layer(2, "z"))).toBe(true);
    expect(p.layerMap![0].lock).toBe("approved");   // never silently unlocked
  });

  it("an own write to one layer does not hide drift on another", () => {
    let p = reconcile(createProject("T"), snap(layer(2, "a"), layer(3, "x")));
    p = reconcile(p, snap(layer(2, "b"), layer(3, "y")), [2]);
    expect(p.revisions).toHaveLength(1);
    expect(p.revisions[0].layers).toEqual([3]);
  });

  it("unlocking records a revision and keeps the approval history", () => {
    let p = reconcile(createProject("T"), snap(layer(2, "a")));
    p = approveLayer(p, layer(2, "a"));
    const n = p.approvals.length;
    p = unlockLayer(p, layer(2, "a"));
    expect(p.layerMap![0].lock).toBe("none");
    expect(p.revisions.at(-1)?.kind).toBe("unlock");
    expect(p.approvals.length).toBe(n + 1);
  });
});
