import { describe, expect, test } from "bun:test";
import { ensureBunTest } from "./ensure-bun-test";
ensureBunTest(import.meta.path);
import {
  composeCanonicalGrokPromptInput,
  firstNonEmptyGrokCatalog,
  GROK_PRIMARY_MODEL,
  grokCommandCatalogUsable,
  grokNativeDeleteUsable,
  mergeGrokComposerCommands,
  resolveGrokSessionDeleteDecision,
  resolveComposerCommandSource,
  resolveConfiguredRuntimeKind,
  selectGrokFeatureStates,
  supportsCanonicalGrokDraft,
} from "../src/react-app/shell/session-route/agent-runtime-routing";
import { runtimeExpertIdentityEntries } from "../src/react-app/shell/session-route/runtime-session-sidebar";
import { listRuntimeSessionsFailVisible } from "../src/react-app/shell/session-route/runtime-session-list-policy";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  grokProfileSelection,
  selectedGrokProfileId,
} from "../src/react-app/capabilities/agent-runtime/controller";

const selection = {
  state: "ok" as const,
  complete: true,
  config: {
    version: 1 as const,
    revision: 2,
    defaultRuntimeKind: "opencode" as const,
    workspaceOverrides: { grok: "grok-build" as const },
  },
  availableRuntimeKinds: ["opencode" as const, "grok-build" as const],
  selectableDefaultRuntimeKinds: ["opencode" as const, "grok-build" as const],
  health: [],
};

describe("agent runtime route selection", () => {
  test("uses sticky workspace override before the global default", () => {
    expect(resolveConfiguredRuntimeKind(selection, "grok")).toBe("grok-build");
    expect(resolveConfiguredRuntimeKind(selection, "other")).toBe("opencode");
    expect(GROK_PRIMARY_MODEL).toEqual({ modelId: "grok-4.5", variant: "low" });
  });

  test("keeps system Grok as the default and maps managed selection explicitly", () => {
    expect(selectedGrokProfileId()).toBe("system");
    expect(selectedGrokProfileId({ homeMode: "managed" })).toBe("managed");
    expect(grokProfileSelection("system")).toEqual({
      profileId: "system",
      homeMode: "system",
      binaryMode: "system",
    });
    expect(grokProfileSelection("managed")).toEqual({
      profileId: "managed",
      homeMode: "managed",
      binaryMode: "system",
    });
  });

  test("fails closed for draft shapes not yet supported by canonical ACP", () => {
    const supported = {
      mode: "prompt" as const,
      hasCommand: false,
      hasNonTextParts: false,
      hasCustomWorkspace: false,
      hasAgentOverride: false,
      hasToolOverrides: false,
    };
    expect(supportsCanonicalGrokDraft(supported)).toBe(true);
    expect(supportsCanonicalGrokDraft({ ...supported, mode: "shell" })).toBe(false);
    expect(supportsCanonicalGrokDraft({ ...supported, hasCommand: true })).toBe(true);
    expect(supportsCanonicalGrokDraft({ ...supported, hasFileAttachments: true })).toBe(true);
    expect(supportsCanonicalGrokDraft({ ...supported, hasNonTextParts: true })).toBe(false);
    expect(supportsCanonicalGrokDraft({ ...supported, hasCustomWorkspace: true })).toBe(false);
    expect(supportsCanonicalGrokDraft({ ...supported, hasAgentOverride: true })).toBe(false);
    expect(supportsCanonicalGrokDraft({ ...supported, hasToolOverrides: true })).toBe(false);
  });

  test("projects only safe Expert identity metadata from runtime session inventory", () => {
    expect(runtimeExpertIdentityEntries([{
      productSessionId: "expert-session",
      runtimeKind: "grok-build",
      runtimeSessionId: "native",
      workspaceId: "workspace",
      cwd: "/runtime/expert",
      profileId: "system",
      createdAt: 1,
      updatedAt: 1,
      status: { type: "idle" },
      profile: { kind: "expert", expertId: "expert-a" },
    }])).toEqual([{ sessionId: "expert-session", expertId: "expert-a" }]);
  });

  test("marks canonical inventory failures incomplete instead of silently hiding sessions", async () => {
    await expect(listRuntimeSessionsFailVisible({
      workspaceId: "workspace",
      listRuntimeSessions: async () => {
        throw new Error("fixture unavailable");
      },
    })).resolves.toEqual({
      items: [],
      complete: false,
      failures: [{
        productSessionId: "*",
        runtimeKind: "grok-build",
        code: "runtime_session_list_failed",
      }],
    });
  });

  test("keeps Grok composer discovery runtime-scoped and Expert create canonical", () => {
    const appRoot = join(import.meta.dir, "..");
    const modelSelect = readFileSync(join(
      appRoot,
      "src/react-app/capabilities/model-selection/model-select-container.tsx",
    ), "utf8");
    const surface = readFileSync(join(
      appRoot,
      "src/react-app/shell/session-route/surface-props-hook-impl.ts",
    ), "utf8");
    expect(modelSelect).toContain("enabled && sessionRouteProviderListEnabled");
    expect(modelSelect).toContain("props.options ?? discovered.options");
    expect(surface).not.toContain("startExpertColdPrewarm(");
    expect(surface).toContain("const canonicalExpert = pageMode === \"expert\" && canonicalSession");
    expect(surface).toContain("await runtimeClient.setRuntimeSessionModel(");
    expect(surface).toContain("runtimeModelCatalog?.defaultModelRef?.modelId");
    expect(surface).toContain("variant: GROK_PRIMARY_MODEL.variant");
  });

  test("does not treat the default craft mode's implicit tools as a Grok tool override", () => {
    // Regression: a brand-new Grok session must accept a plain-text prompt.
    // The default collaboration mode is craft, whose implicit
    // DEFAULT_EXECUTION_TOOLS must NOT count as a user tool override —
    // otherwise every plain-text Grok prompt is rejected.
    const appRoot = join(import.meta.dir, "..");
    const surface = readFileSync(join(
      appRoot,
      "src/react-app/shell/session-route/surface-props-hook-impl.ts",
    ), "utf8");
    expect(surface).toContain(
      "const preCreateRuntimeToolAccess = canonicalGrok",
    );
    expect(surface).toContain(
      "? pendingForColdPath?.tools",
    );
    expect(surface).not.toMatch(
      /canonicalGrok\s*\?\s*resolveComposerRuntimeTools\(/,
    );
  });

  test("does not resend per-turn instructions for Grok (sticky session profile)", () => {
    // Regression: the Grok adapter rejects per-turn systemPrompt/agentId/
    // toolAccess that differ from the sticky session profile saved at create
    // time. The per-turn combinedSystem is assembled differently from the
    // create-time profile, so Grok prompts must not resend it.
    const appRoot = join(import.meta.dir, "..");
    const surface = readFileSync(join(
      appRoot,
      "src/react-app/shell/session-route/surface-props-hook-impl.ts",
    ), "utf8");
    expect(surface).toContain(
      "selectedRuntimeKind === \"grok-build\"",
    );
    expect(surface).toContain("must not be resent");
    expect(surface).toContain("composeGrokPromptInputFromDraft");
    expect(surface).toContain("composeCanonicalGrokPromptInput");
    // The OpenCode branch still sends systemPrompt/agentId/toolAccess/parts.
    expect(surface).toContain("...(combinedSystem ? { systemPrompt: combinedSystem } : {})");
    expect(surface).toContain("parts: parts as AgentRuntimePromptPartInput[]");
  });

  test("Grok prompt payload includes attachment parts on the shipped composer path", () => {
    expect(composeCanonicalGrokPromptInput({
      text: "summarize",
      messageId: "msg-1",
      parts: [
        { type: "text", text: "summarize" },
        { type: "file", url: "file:///workspace/notes.md", filename: "notes.md", mime: "text/markdown" },
        { type: "agent", name: "blocked" },
      ],
    })).toEqual({
      text: "summarize",
      messageId: "msg-1",
      parts: [
        { type: "text", text: "summarize" },
        { type: "file", url: "file:///workspace/notes.md", filename: "notes.md", mime: "text/markdown" },
      ],
    });
    const appRoot = join(import.meta.dir, "..");
    const surface = readFileSync(join(
      appRoot,
      "src/react-app/shell/session-route/surface-props-hook-impl.ts",
    ), "utf8");
    const sessionSurface = readFileSync(join(
      appRoot,
      "src/react-app/domains/session/surface/session-surface.tsx",
    ), "utf8");
    expect(surface).toContain("composeGrokPromptInputFromDraft");
    expect(surface).toContain("attachmentsEnabled: true");
    expect(surface).not.toContain("attachmentsEnabled: routeRuntimeKind !== \"grok-build\"");
    expect(surface).not.toContain("session.grok_runtime_attachments_unsupported");
    expect(sessionSurface).not.toContain("session.grok_runtime_attachments_unsupported");
    expect(sessionSurface).toContain("attachmentsEnabled: props.attachmentsEnabled");
    expect(sessionSurface).toContain("attachmentsEnabled={props.attachmentsEnabled}");
  });

  test("Grok slash picker prefers live command.catalog.updated over OpenCode listCommands", () => {
    expect(mergeGrokComposerCommands({
      liveItems: [{ name: "stale-only" }],
      listedItems: [{
        id: "grok:command:compact",
        name: "compact",
        description: "Compress conversation history to save context window",
        source: "command",
      }],
    })).toEqual([
      { id: "grok:command:stale-only", name: "stale-only", source: "command" },
      {
        id: "grok:command:compact",
        name: "compact",
        description: "Compress conversation history to save context window",
        source: "command",
      },
    ]);
    expect(mergeGrokComposerCommands({
      listedItems: [{
        id: "grok:skill:review",
        name: "review",
        description: "Review",
        source: "skill",
      }],
    })).toEqual([{
      id: "grok:skill:review",
      name: "review",
      description: "Review",
      source: "command",
    }]);
    expect(firstNonEmptyGrokCatalog([
      [],
      undefined,
      [{ name: "compact" }],
    ])).toEqual([{ name: "compact" }]);
    expect(grokCommandCatalogUsable([
      { feature: "command.list", state: "degraded", source: "lazy_call" },
    ])).toBe(true);
    expect(grokCommandCatalogUsable([
      { feature: "command.list", state: "unsupported", source: "initialize" },
    ])).toBe(false);
    expect(selectGrokFeatureStates({
      health: [{
        health: {
          runtimeKind: "grok-build",
          health: "ready",
          checkedAt: 1,
          capabilities: {
            protocolVersion: "1",
            features: ["command.list"],
            featureStates: [
              { feature: "command.list", state: "degraded", source: "lazy_call" },
            ],
          },
        },
      }],
    })).toEqual([
      { feature: "command.list", state: "degraded", source: "lazy_call" },
    ]);
    const appRoot = join(import.meta.dir, "..");
    const surface = readFileSync(join(
      appRoot,
      "src/react-app/shell/session-route/surface-props-hook-impl.ts",
    ), "utf8");
    const sessionSurface = readFileSync(join(
      appRoot,
      "src/react-app/domains/session/surface/session-surface.tsx",
    ), "utf8");
    expect(surface).toContain("mergeGrokComposerCommands");
    expect(surface).toContain("commandCatalogKey");
    expect(surface).toContain("listRuntimeSessionCommands");
    expect(sessionSurface).toContain("props.selectedRuntimeKind !== \"grok-build\"");
    expect(sessionSurface).toContain("const runtimeSupportsOpenCodeComposerTools =");
    expect(sessionSurface).toContain('runtimeKind !== "grok-build"');
    expect(surface).toContain("selectedRuntimeKind === \"grok-build\"");
    expect(surface).toContain("resolveComposerCommandSource");
    expect(surface).not.toMatch(/routeRuntimeKind === "grok-build"[\s\S]*listSlashCommands\(/);
  });

  test("Grok native delete UI decision fails closed when unsupported", () => {
    expect(resolveGrokSessionDeleteDecision({
      runtimeKind: "grok-build",
      featureStates: [{
        feature: "session.delete",
        state: "unsupported",
        source: "initialize",
      }],
    })).toEqual({ allowed: false, outcome: "unsupported", deleted: false });
    expect(grokNativeDeleteUsable([{
      feature: "session.delete",
      state: "unsupported",
      source: "initialize",
    }])).toBe(false);
    expect(resolveGrokSessionDeleteDecision({
      runtimeKind: "opencode",
      featureStates: [{
        feature: "session.delete",
        state: "unsupported",
        source: "initialize",
      }],
    }).allowed).toBe(true);
    expect(resolveGrokSessionDeleteDecision({
      runtimeKind: "grok-build",
      featureStates: [{
        feature: "session.delete",
        state: "supported",
        source: "initialize",
      }],
    }).allowed).toBe(true);
    expect(resolveGrokSessionDeleteDecision({
      runtimeKind: "grok-build",
      featureStates: [],
    })).toEqual({ allowed: false, outcome: "unknown", deleted: false });
    expect(grokNativeDeleteUsable([])).toBe(false);
  });

  test("Grok slash execution stays on the native command path even when catalog source is skill", () => {
    expect(resolveComposerCommandSource({
      runtimeKind: "grok-build",
      declaredSource: "skill",
    })).toBe("command");
    expect(resolveComposerCommandSource({
      runtimeKind: "opencode",
      declaredSource: "skill",
    })).toBe("skill");
    expect(resolveComposerCommandSource({
      runtimeKind: "opencode",
      declaredSource: "command",
    })).toBe("command");
  });
});
