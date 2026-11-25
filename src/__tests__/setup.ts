import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetSettingsCacheForTests } from "../lib/settings";

// The first-run tour is a dialog; tests start as a returning user unless they say otherwise.
beforeEach(() => { localStorage.setItem("motioncraft.settings.v1", JSON.stringify({ tourSeen: true })); resetSettingsCacheForTests(); });

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetSettingsCacheForTests();
});
