import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import {
  inheritPersistedAgentEngine,
  normalizeAgentEngine,
  persistAgentEngineField,
  readEngineCreateSessionInput,
} from "../src/engines/agent-engine-policy.js";
import { persistWorkspaceConfigEntry } from "../src/workspace/workspace-persist.js";
import { resolveEngineId } from "../src/engines/types.js";

function workspace(agentEngine?: WorkspaceInfo["agentEngine"]): WorkspaceInfo {
  return {
    id: "ws_office",
    name: "Office",
    path: "/workspace/office",
    preset: "default",
    workspaceType: "local",
    ...(agentEngine ? { agentEngine } : {}),
  };
}

describe("agent engine defaulting and persist", () => {
  test("missing or invalid engine is opencode, not pi", () => {
    expect(normalizeAgentEngine(undefined)).toBe("opencode");
    expect(normalizeAgentEngine(null)).toBe("opencode");
    expect(normalizeAgentEngine("")).toBe("opencode");
    expect(normalizeAgentEngine("opencode")).toBe("opencode");
    expect(normalizeAgentEngine("experimental")).toBe("opencode");
    expect(normalizeAgentEngine("pi")).toBe("pi");
  });

  test("resolveEngineId treats a missing workspace field as opencode", () => {
    const config = {
      agentEngine: undefined,
    } as Parameters<typeof resolveEngineId>[0];
    expect(resolveEngineId(config, workspace())).toBe("opencode");
    expect(resolveEngineId(config, workspace("pi"))).toBe("pi");
    expect(resolveEngineId({ ...config, agentEngine: "pi" }, workspace())).toBe("pi");
  });

  test("persist writes explicit pi/opencode and never invents pi for a missing field", () => {
    expect(persistAgentEngineField(undefined)).toEqual({});
    expect(persistAgentEngineField("pi")).toEqual({ agentEngine: "pi" });
    expect(persistAgentEngineField("opencode")).toEqual({ agentEngine: "opencode" });

    const omitted = persistWorkspaceConfigEntry(workspace());
    expect(omitted.agentEngine).toBeUndefined();
    expect(omitted.agentEngine).not.toBe("pi");

    expect(persistWorkspaceConfigEntry(workspace("pi")).agentEngine).toBe("pi");
    expect(persistWorkspaceConfigEntry(workspace("opencode")).agentEngine).toBe("opencode");
  });

  test("old omitted-field persist that invented pi would fail", () => {
    const oldBrokenPersist = (value: unknown) => ({
      agentEngine: value === "pi" || value === "opencode" ? value : "pi",
    });
    expect(oldBrokenPersist(undefined).agentEngine).toBe("pi");
    expect(persistAgentEngineField(undefined).agentEngine).not.toBe("pi");
    expect(persistWorkspaceConfigEntry(workspace()).agentEngine).not.toBe("pi");
  });

  test("create session input forwards directory instead of dropping it", () => {
    expect(
      readEngineCreateSessionInput({
        title: " Expert ",
        directory: "/workspace/office/.experts/a",
        agentId: "build",
      }),
    ).toEqual({
      title: "Expert",
      directory: "/workspace/office/.experts/a",
      agentId: "build",
    });
    expect(readEngineCreateSessionInput({ title: "only" })).toEqual({ title: "only" });
    expect(readEngineCreateSessionInput(null).directory).toBeUndefined();
  });

  test("field-less CLI workspace inherits persisted pi and does not invent opencode", () => {
    const persisted = [{ path: "/workspace/office", agentEngine: "pi" as const }];
    expect(
      inheritPersistedAgentEngine({ path: "/workspace/office" }, persisted).agentEngine,
    ).toBe("pi");
    expect(
      inheritPersistedAgentEngine({ path: "/workspace/office", agentEngine: "opencode" }, persisted)
        .agentEngine,
    ).toBe("opencode");
    expect(
      inheritPersistedAgentEngine({ path: "/workspace/other" }, persisted).agentEngine,
    ).toBeUndefined();
  });

  test("persistServerWorkspaceState writes persistWorkspaceConfigEntry", () => {
    const serverSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/server.ts"),
      "utf8",
    );
    expect(serverSource).toContain("persistWorkspaceConfigEntry");
    expect(serverSource).toContain("config.workspaces.map(persistWorkspaceConfigEntry)");
    const configSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/config.ts"),
      "utf8",
    );
    expect(configSource).toContain("inheritPersistedAgentEngine");
  });
});
