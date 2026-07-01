import { describe, expect, test } from "bun:test";

import {
  applyCloudPluginToWorkspace,
  removeCloudPluginFromWorkspace,
  type ExtensionsWorkspaceWriter,
} from "../src/react-app/domains/settings/state/extensions-store-cloud-import-applier";
import {
  buildCloudSkillHubImportPlan,
  cloudPluginRemovalPlan,
  toConfigPluginListEntries,
  toProjectPluginListEntries,
} from "../src/react-app/domains/settings/state/extensions-store-model";
import {
  persistStoredHubReposToStorage,
  readStoredHubReposFromStorage,
} from "../src/react-app/domains/settings/state/extensions-store-storage";

type RecordedWrite =
  | { type: "deleteMcpConfig"; name: string }
  | { type: "deleteSkill"; name: string }
  | { type: "upsertMcpConfig"; name: string; config: Record<string, unknown> }
  | { type: "upsertSkill"; name: string; content: string; description: string }
  | { type: "writeWorkspaceFile"; path: string; content: string };

function createWriter(options: { failOnPath?: string } = {}) {
  const writes: RecordedWrite[] = [];
  const writer: ExtensionsWorkspaceWriter = {
    async deleteMcpConfig(name) {
      writes.push({ type: "deleteMcpConfig", name });
    },
    async deleteSkill(name) {
      writes.push({ type: "deleteSkill", name });
    },
    async upsertMcpConfig(name, config) {
      writes.push({ type: "upsertMcpConfig", name, config });
    },
    async upsertSkill(name, content, description) {
      writes.push({ type: "upsertSkill", name, content, description });
    },
    async writeWorkspaceFile(path, content) {
      if (path === options.failOnPath) throw new Error("write failed");
      writes.push({ type: "writeWorkspaceFile", path, content });
    },
  };
  return { writer, writes };
}

const now = 1782200000000;

const pluginResolved = {
  plugin: {
    id: "plugin-alpha",
    name: "Alpha Tools",
    description: "Workspace tools",
    updatedAt: now,
  },
  memberships: [
    {
      configObject: {
        id: "obj-skill",
        title: "Code Review",
        description: "Review code",
        objectType: "skill",
        status: "active",
        updatedAt: now,
        latestVersion: {
          id: "ver-skill",
          rawSourceText: "---\nname: old\ndescription: old\n---\n\nReview the diff.",
          normalizedPayloadJson: null,
        },
      },
    },
    {
      configObject: {
        id: "obj-mcp",
        title: "Search MCP",
        description: "Search server",
        objectType: "mcp",
        status: "active",
        updatedAt: now,
        latestVersion: {
          id: "ver-mcp",
          rawSourceText: JSON.stringify({ command: "node", args: ["server.js"] }),
          normalizedPayloadJson: null,
        },
      },
    },
    {
      configObject: {
        id: "obj-agent",
        title: "Deploy Agent",
        description: "Deploy helper",
        objectType: "agent",
        status: "active",
        updatedAt: now,
        latestVersion: {
          id: "ver-agent",
          rawSourceText: "agent body",
          normalizedPayloadJson: null,
        },
      },
    },
  ],
};

describe("extensions store storage", () => {
  test("persists and reads hub repos through an injected storage boundary", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const selected = { owner: "WeaveQ", repo: "onmyagent-hub", ref: "main" };

    persistStoredHubReposToStorage(storage, {
      selected,
      repos: [selected, { owner: "Other", repo: "skills", ref: "dev" }],
    });

    expect(readStoredHubReposFromStorage(storage)).toEqual({
      selected,
      repos: [selected, { owner: "Other", repo: "skills", ref: "dev" }],
    });
  });

  test("throws malformed persisted hub repo JSON at the pure boundary", () => {
    const storage = { getItem: () => "{bad json" };
    expect(() => readStoredHubReposFromStorage(storage)).toThrow();
  });
});

describe("extensions store model boundaries", () => {
  test("deduplicates plugin list entries with config entries remaining removable", () => {
    expect(toConfigPluginListEntries(["alpha", " alpha ", "", "beta"])).toEqual([
      { name: "alpha", source: "config", removable: true },
      { name: "beta", source: "config", removable: true },
    ]);
    expect(toProjectPluginListEntries([
      { spec: "alpha", source: "dir.project" },
      { spec: "alpha", source: "config" },
      { spec: "beta", source: "dir.global" },
    ])).toEqual([
      { name: "alpha", source: "config", removable: true },
      { name: "beta", source: "dir.global", removable: false },
    ]);
  });

  test("builds cloud skill hub plans without colliding with existing names", () => {
    const plan = buildCloudSkillHubImportPlan({
      existingSkillNames: ["review-pr"],
      imported: {
        hubId: "hub-alpha",
        importedAt: now - 1000,
        name: "Hub Alpha",
        skillIds: ["old-id"],
        skillNames: ["old-skill"],
      },
      hub: {
        id: "hub-alpha",
        name: "Hub Alpha",
        description: "Team skills",
        shared: true,
        updatedAt: now,
        skills: [
          {
            id: "skill-1",
            title: "Review PR",
            description: "Review pull requests",
            skillText: "Review the diff.",
            shared: true,
            updatedAt: now,
          },
        ],
      },
    });

    expect(plan.nextSkillNames[0]).not.toBe("review-pr");
    expect(plan.removedSkillNames).toEqual(["old-skill"]);
  });

  test("classifies managed and remaining cloud plugin files during removal", () => {
    expect(cloudPluginRemovalPlan([
      { objectType: "skill", path: ".opencode/skills/pkg/example/SKILL.md" },
      { objectType: "mcp", path: "opencode.jsonc#mcp.pkg-search" },
      { objectType: "agent", path: ".opencode/agents/pkg/agent.md" },
    ])).toEqual({
      removedSkillNames: ["example"],
      removedMcpNames: ["pkg-search"],
      removedManagedCount: 2,
      hasRemainingFiles: true,
    });
  });
});

describe("extensions store cloud import applier", () => {
  test("applies active cloud plugin objects and persists imported files", async () => {
    const { writer, writes } = createWriter();
    let persisted = null as unknown;
    const reloads: unknown[] = [];

    const files = await applyCloudPluginToWorkspace({
      importedCloudPlugins: {},
      marketplaceId: "market-alpha",
      markReloadRequired: (reason, trigger) => reloads.push({ reason, trigger }),
      persistImportedCloudPlugins: async (next) => {
        persisted = next;
      },
      resolved: pluginResolved as never,
      writer,
    });

    expect(files.map((file) => file.objectType)).toEqual(["skill", "mcp", "agent"]);
    expect(writes.map((write) => write.type)).toEqual(["writeWorkspaceFile", "upsertMcpConfig", "writeWorkspaceFile"]);
    expect(Object.keys(persisted as Record<string, unknown>)).toEqual(["plugin-alpha"]);
    expect(reloads.length).toBe(3);
  });

  test("does not persist a cloud plugin import when a workspace file write fails", async () => {
    const { writer } = createWriter({ failOnPath: ".opencode/agents/alpha-tools-plugin/deploy-agent.md" });
    let persisted = false;

    await expect(applyCloudPluginToWorkspace({
      importedCloudPlugins: {},
      marketplaceId: null,
      persistImportedCloudPlugins: async () => {
        persisted = true;
      },
      resolved: pluginResolved as never,
      writer,
    })).rejects.toThrow("write failed");

    expect(persisted).toBe(false);
  });

  test("removes managed cloud plugin files and reports remaining workspace files", async () => {
    const { writer, writes } = createWriter();
    let persisted = { untouched: true } as Record<string, unknown>;

    const result = await removeCloudPluginFromWorkspace({
      importedCloudPlugins: {
        "plugin-alpha": {
          pluginId: "plugin-alpha",
          marketplaceId: null,
          name: "Alpha Tools",
          description: "Workspace tools",
          updatedAt: now,
          importedAt: now,
          files: [
            { objectType: "skill", path: ".opencode/skills/pkg/example/SKILL.md" },
            { objectType: "mcp", path: "opencode.jsonc#mcp.pkg-search" },
            { objectType: "agent", path: ".opencode/agents/pkg/agent.md" },
          ],
        },
      },
      pluginId: "plugin-alpha",
      persistImportedCloudPlugins: async (next) => {
        persisted = next;
      },
      writer,
    });

    expect(result).toEqual({ name: "Alpha Tools", hasRemainingFiles: true });
    expect(writes).toEqual([
      { type: "deleteSkill", name: "example" },
      { type: "deleteMcpConfig", name: "pkg-search" },
    ]);
    expect(persisted).toEqual({});
  });

  test("fails clearly when removing a plugin that was not imported", async () => {
    const { writer } = createWriter();
    await expect(removeCloudPluginFromWorkspace({
      importedCloudPlugins: {},
      pluginId: "missing",
      persistImportedCloudPlugins: async () => undefined,
      writer,
    })).rejects.toThrow("Marketplace package is not installed in this workspace.");
  });
});
