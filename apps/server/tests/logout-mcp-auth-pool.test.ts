import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const serverRoot = join(import.meta.dir, "..");

describe("logoutMcpAuth pool wiring (structural + shipped pool)", () => {
  test("proxy logout acquires via pool helper and clears workspace entries", () => {
    const source = readFileSync(
      join(serverRoot, "src/services/opencode-proxy.ts"),
      "utf8",
    );
    const logoutSlice = source.slice(source.indexOf("export async function logoutMcpAuth"));
    expect(logoutSlice).toContain("getWorkspaceOpencodeClient");
    expect(logoutSlice).toContain("clearWorkspaceOpencodeClients");
    // Must not bare-create clients inside logout after pool migration
    expect(logoutSlice).not.toMatch(
      /createWorkspaceOpencodeClient\(\s*config\s*,\s*workspace\s*\)/,
    );
  });
});
