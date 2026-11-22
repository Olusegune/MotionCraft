import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetSettingsCacheForTests } from "../lib/settings";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetSettingsCacheForTests();
});
