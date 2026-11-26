// The real Windows Credential Manager, round trip, using an entry QuickPath itself owns and cleaning up after. Skipped (not passed) off Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WindowsStore } from "../src/keys.ts";

const skip = process.platform === "win32" ? false : "Windows only: NOT CHECKED";

test("a key written to Windows Credential Manager reads back exactly, and is gone after removal", { skip }, async () => {
  const s = new WindowsStore();
  const target = "QuickPath/kie";
  const before = await s.get(target);                                 // the person's own saved key, if any: put it back afterwards
  const secret = "test_roundtrip-0123456789.ABCDEFG";
  try {
    await s.set(target, secret);
    assert.equal(await s.get(target), secret);
    assert.equal(await s.remove(target), true);
    assert.equal(await s.get(target), "");
    assert.equal(await s.remove(target), false, "removing what is not there says so");
  } finally {
    if (before) await s.set(target, before); else await s.remove(target);
  }
});

test("only QuickPath's own entries can be written or removed, never MotionCraft's or anything else", { skip }, async () => {
  const s = new WindowsStore();
  await assert.rejects(s.set("kie-api-key.motioncraft", "x".repeat(20)), /cannot be written/);
  await assert.rejects(s.set("QuickPath/evil'; calc #", "x".repeat(20)), /cannot be written/);
  await assert.rejects(s.set("other", "x".repeat(20)), /cannot be written/);
  assert.equal(await s.remove("kie-api-key.motioncraft"), false);
  assert.equal(await s.remove("QuickPath/../x"), false);
  assert.equal(await s.get("something-else"), "", "reading is limited to the fixed names too");
});
