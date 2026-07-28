import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applySetStateAction,
  canUseOnMyAgentCapability,
  formatSkillPath,
} from "../src/react-app/domains/settings/state/extensions-store-model";
import { createInitialExtensionsMutableState } from "../src/react-app/domains/settings/state/extensions-store-snapshot";

const appRoot = join(import.meta.dir, "..");

describe("extensions-store pure helpers (shipped)", () => {
  test("store imports formatSkillPath and canUseOnMyAgentCapability", () => {
    const store = readFileSync(
      join(appRoot, "src/react-app/domains/settings/state/extensions-store.ts"),
      "utf8",
    );
    expect(store).toContain("formatSkillPath");
    expect(store).toContain("canUseOnMyAgentCapability");
    expect(store).toContain("createInitialExtensionsMutableState");
    expect(store).not.toMatch(/const formatSkillPath = /);
  });

  test("formatSkillPath strips SKILL.md suffix", () => {
    expect(formatSkillPath("/ws/.opencode/skills/foo/SKILL.md")).toBe(
      "/ws/.opencode/skills/foo",
    );
    expect(formatSkillPath("skills\\bar\\SKILL.md")).toBe("skills\\bar");
  });

  test("applySetStateAction supports value and updater", () => {
    expect(applySetStateAction(1, 2)).toBe(2);
    expect(applySetStateAction(1, (n) => n + 3)).toBe(4);
  });

  test("canUseOnMyAgentCapability requires connected client workspace capability", () => {
    expect(
      canUseOnMyAgentCapability({
        status: "connected",
        hasClient: true,
        workspaceId: "ws_1",
        capability: true,
      }),
    ).toBe(true);
    expect(
      canUseOnMyAgentCapability({
        status: "disconnected",
        hasClient: true,
        workspaceId: "ws_1",
        capability: true,
      }),
    ).toBe(false);
    expect(
      canUseOnMyAgentCapability({
        status: "connected",
        hasClient: true,
        workspaceId: "",
        capability: true,
      }),
    ).toBe(false);
  });

  test("createInitialExtensionsMutableState seeds empty lists", () => {
    const hub = { owner: "o", repo: "r", ref: "main" };
    const state = createInitialExtensionsMutableState({
      hubRepo: hub,
      hubRepos: [hub],
    });
    expect(state.skills).toEqual([]);
    expect(state.pluginList).toEqual([]);
    expect(state.hubRepo).toEqual(hub);
    expect(state.pluginScope).toBe("project");
  });
});
