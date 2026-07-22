/**
 * Structural contracts for frontend host-thin goal:
 * expert/assistant/session-surface/composer/surface-props modularization,
 * SessionSurface domain bags, and extracted pure helpers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const repo = join(root, "../..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function readRepo(rel: string) {
  return readFileSync(join(repo, rel), "utf8");
}

function lineCount(rel: string) {
  return read(rel).split("\n").length;
}

describe("frontend host thin modules", () => {
  test("shared host hooks exist and are imported by expert + assistant", () => {
    const hooks = [
      "src/react-app/domains/session/pages/use-my-expert-packages.ts",
      "src/react-app/domains/session/pages/use-agent-panel-resize.ts",
      "src/react-app/domains/session/pages/use-session-host-side-panel.ts",
      "src/react-app/domains/session/pages/use-summon-marketplace-expert.ts",
    ];
    for (const h of hooks) {
      expect(existsSync(join(root, h))).toBe(true);
      expect(read(h)).toContain("export function");
    }
    const expert = read("src/react-app/domains/session/pages/expert.tsx");
    const assistant = read("src/react-app/domains/session/pages/assistant.tsx");
    expect(expert).toContain("useSessionHostSidePanel");
    expect(expert).toContain("useMyExpertPackages");
    expect(expert).toContain("useAgentPanelResize");
    expect(assistant).toContain("useSessionHostSidePanel");
    expect(assistant).toContain("useMyExpertPackages");
    expect(assistant).toContain("useSummonMarketplaceExpert");
  });

  test("host page line counts are below pre-optimization baseline", () => {
    // Pre-goal baselines from branch-gate / audit
    expect(lineCount("src/react-app/domains/session/pages/expert.tsx")).toBeLessThan(2560);
    expect(lineCount("src/react-app/domains/session/pages/assistant.tsx")).toBeLessThan(1660);
    expect(
      lineCount("src/react-app/shell/session-route/surface-props-hook.ts"),
    ).toBeLessThan(200);
    expect(
      existsSync(
        join(root, "src/react-app/shell/session-route/surface-props-hook-impl.ts"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(root, "src/react-app/shell/session-route/surface-props-bags.ts"),
      ),
    ).toBe(true);
  });

  test("SessionSurface public props use domain bags with fewer top-level fields", () => {
    const types = read(
      "src/react-app/domains/session/surface/session-surface-types.ts",
    );
    expect(types).toContain("export type SessionSurfaceModelBag");
    expect(types).toContain("export type SessionSurfacePermissionBag");
    expect(types).toContain("export type SessionSurfaceMarketplaceBag");
    expect(types).toContain("export type SessionSurfaceDraftWorkspaceBag");
    expect(types).toContain("export function bagSessionSurfaceProps");
    expect(types).toContain("export function flattenSessionSurfaceProps");
    // Top-level bags present on SessionSurfaceProps
    expect(types).toMatch(/export type SessionSurfaceProps = \{[\s\S]*model: SessionSurfaceModelBag/);
    expect(types).toMatch(/permission: SessionSurfacePermissionBag/);
    expect(types).toMatch(/marketplace: SessionSurfaceMarketplaceBag/);
    expect(types).toMatch(/draftWorkspace: SessionSurfaceDraftWorkspaceBag/);
    // Entry flattens bags for internal body
    const surface = read(
      "src/react-app/domains/session/surface/session-surface.tsx",
    );
    expect(surface).toContain("flattenSessionSurfaceProps");
  });

  test("composer uses extracted slash-command merge helper", () => {
    expect(
      existsSync(
        join(
          root,
          "src/react-app/domains/session/surface/composer/slash-command-merge.ts",
        ),
      ),
    ).toBe(true);
    const composer = read(
      "src/react-app/domains/session/surface/composer/composer.tsx",
    );
    expect(composer).toContain("mergeSlashCommandsWithSkills");
  });
});

describe("shipped pure helpers", () => {
  test("mergeSlashCommandsWithSkills prefers command.list rows over skill stubs", async () => {
    const { mergeSlashCommandsWithSkills } = await import(
      "../src/react-app/domains/session/surface/composer/slash-command-merge.ts"
    );
    const merged = mergeSlashCommandsWithSkills(
      [
        {
          id: "cmd:foo",
          name: "foo",
          description: "from-opencode",
          source: "command",
        },
      ],
      [
        {
          name: "foo",
          description: "from-skill",
        } as { name: string; description: string },
      ],
    );
    expect(merged.commands).toHaveLength(1);
    expect(merged.commands[0]?.description).toBe("from-opencode");
    expect(merged.skillsForState?.length).toBe(1);
  });

  test("bagSessionSurfaceProps / flattenSessionSurfaceProps round-trip model bag", async () => {
    const {
      bagSessionSurfaceProps,
      flattenSessionSurfaceProps,
    } = await import(
      "../src/react-app/domains/session/surface/session-surface-types.ts"
    );
    const flat = {
      client: {} as never,
      workspaceId: "w",
      workspaceRoot: "/tmp",
      sessionId: "s",
      opencodeBaseUrl: "http://127.0.0.1",
      onmyagentToken: "t",
      developerMode: false,
      modelLabel: "m",
      onModelClick: () => {},
      modelPickerOpen: false,
      selectedModel: { providerID: "p", modelID: "m" },
      onModelPickerOpenChange: () => {},
      onModelChange: () => {},
      modelVariantLabel: "v",
      modelVariant: null,
      onModelVariantChange: () => {},
      onSendDraft: () => {},
      onDraftChange: () => {},
      attachmentsEnabled: true,
      attachmentsDisabledReason: null,
      agentLabel: "a",
      selectedAgent: null,
      listAgents: async () => [],
      onSelectAgent: () => {},
      listCommands: async () => [],
      recentFiles: [],
      searchFiles: async () => [],
      isRemoteWorkspace: false,
      isSandboxWorkspace: false,
      draftWorkspaceDirectory: "/space",
      draftWorkspaceOwnerId: "w",
    };
    const bagged = bagSessionSurfaceProps(flat as never);
    expect(bagged.model.modelLabel).toBe("m");
    expect(bagged.draftWorkspace.draftWorkspaceDirectory).toBe("/space");
    expect("modelLabel" in bagged).toBe(false);
    const again = flattenSessionSurfaceProps(bagged);
    expect(again.modelLabel).toBe("m");
    expect(again.draftWorkspaceDirectory).toBe("/space");
  });

  test("inferPlanStepsFromPrompt uses i18n keys not hard-coded CJK literals", async () => {
    const utils = read(
      "src/react-app/domains/session/surface/session-surface-utils.ts",
    );
    expect(utils).toContain('t("session.inferred_plan_file_step_1")');
    expect(utils).not.toContain('"确认目标文件路径和写入内容"');
    const { inferPlanStepsFromPrompt } = await import(
      "../src/react-app/domains/session/surface/session-surface-utils.ts"
    );
    const steps = inferPlanStepsFromPrompt("create a notes.md file");
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.every((s) => typeof s.content === "string" && s.content.length > 0)).toBe(
      true,
    );
  });
});
