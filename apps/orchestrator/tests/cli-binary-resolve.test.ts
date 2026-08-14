import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  isPathLikeBinary,
  resolveBinPath,
} from "../src/cli-binary-resolve";
import { localOpencodeWindowsExtraCandidates } from "../src/cli-shared";

describe("isPathLikeBinary", () => {
  test("treats posix relative and absolute paths as path-like", () => {
    expect(isPathLikeBinary("./opencode")).toBe(true);
    expect(isPathLikeBinary("/usr/local/bin/opencode")).toBe(true);
    expect(isPathLikeBinary("opencode")).toBe(false);
  });

  test("treats Windows drive and UNC paths as path-like", () => {
    expect(isPathLikeBinary("C:\\Tools\\opencode.exe")).toBe(true);
    expect(isPathLikeBinary("D:/apps/opencode.exe")).toBe(true);
    expect(isPathLikeBinary("\\\\server\\share\\opencode.exe")).toBe(true);
    expect(isPathLikeBinary("opencode.exe")).toBe(false);
  });
});

describe("resolveBinPath", () => {
  test("leaves bare command names unchanged", () => {
    expect(resolveBinPath("opencode")).toBe("opencode");
  });
});

describe("localOpencodeWindowsExtraCandidates", () => {
  test("includes LocalAppData and user .opencode bins", () => {
    const home = "C:\\Users\\demo";
    const extras = localOpencodeWindowsExtraCandidates(home, {
      LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
    });
    expect(extras).toContain(join("C:\\Users\\demo\\AppData\\Local", "opencode", "bin", "opencode.exe"));
    expect(extras).toContain(join("C:\\Users\\demo\\AppData\\Local", "Programs", "opencode", "opencode.exe"));
    expect(extras).toContain(join(home, ".opencode", "bin", "opencode.exe"));
  });
});
