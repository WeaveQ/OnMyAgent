import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveOpencodeServeBin } from "./_util.mjs";

describe("resolveOpencodeServeBin", () => {
  test("prefers OPENCODE_BIN when the file exists", () => {
    const resolved = resolveOpencodeServeBin({
      platform: "win32",
      env: { OPENCODE_BIN: "C:\\Tools\\opencode.exe", PATH: "" },
      existsFn: (value) => value === "C:\\Tools\\opencode.exe",
      repoRoot: "C:\\repo",
      homeDir: "C:\\Users\\demo",
    });
    expect(resolved).toBe("C:\\Tools\\opencode.exe");
  });

  test("does not fall back to a bare opencode name on Windows", () => {
    const resolved = resolveOpencodeServeBin({
      platform: "win32",
      env: { PATH: "C:\\missing-bin", LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
      existsFn: () => false,
      repoRoot: "C:\\repo",
      homeDir: "C:\\Users\\demo",
    });
    expect(resolved).toBeNull();
  });

  test("finds the desktop sidecar when PATH has no opencode", () => {
    const sidecar = join("C:\\repo", "apps", "desktop", "resources", "sidecars", "opencode.exe");
    const resolved = resolveOpencodeServeBin({
      platform: "win32",
      env: { PATH: "C:\\Windows\\System32", LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
      existsFn: (value) => value === sidecar,
      repoRoot: "C:\\repo",
      homeDir: "C:\\Users\\demo",
    });
    expect(resolved).toBe(sidecar);
  });
});
