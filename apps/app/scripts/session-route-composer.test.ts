import { describe, expect, test } from "bun:test";

import {
  applySessionAccessMode,
  applySessionScopedValue,
  removeSessionScopedValue,
  buildCollaborationModeSystemPrompt,
  buildGoalRuntimeSystemPrompt,
  buildLanguageSystemPrompt,
  clearConsumedPermissionNotice,
  draftHasSendableContent,
  draftToParts,
  inboxAbsolutePath,
  inboxRelativePath,
  joinSystemParts,
  moveSessionModelOverride,
  moveSessionScopedValue,
  resolveAttachmentUploadTarget,
  resolveComposerRuntimeTools,
  resolveAccessModePermissionReply,
  isLowRiskPermission,
  resolveDraftSendPlan,
  routeForSettingsSection,
  sanitizeUploadFilename,
  updateDefaultModelPrefs,
} from "../src/react-app/shell/session-route/composer";
import { shouldForceNewSessionOnIdle } from "../src/react-app/shell/session-route/auto-new-session";
import type { ComposerAttachment, ComposerDraft, SidebarSessionItem } from "../src/app/types";
import { setLocale } from "../src/i18n";

function draft(input: Partial<ComposerDraft>): ComposerDraft {
  return {
    mode: "prompt",
    parts: [],
    attachments: [],
    text: "",
    ...input,
  };
}

function attachment(input: Partial<ComposerAttachment> & { name: string; kind: "image" | "file" }): ComposerAttachment {
  return {
    id: input.name,
    name: input.name,
    mimeType: input.mimeType ?? (input.kind === "image" ? "image/png" : "text/plain"),
    size: input.size ?? 12,
    kind: input.kind,
    file: input.file ?? new File(["payload"], input.name, { type: input.mimeType ?? "text/plain" }),
    previewUrl: input.previewUrl,
  };
}

describe("session route composer", () => {
  test("maps settings sections to stable route targets", () => {
    // MCP/connectors no longer open Settings → Extensions (removed).
    expect(routeForSettingsSection("commands")).toBe("/settings/general");
    expect(routeForSettingsSection("skills")).toBe("/settings/general");
    expect(routeForSettingsSection("mcps")).toBe("/settings/general");
    expect(routeForSettingsSection("plugins")).toBe("/settings/general");
  });

  test("resets model variant only when default model changes", () => {
    const previous = {
      defaultModel: { providerID: "openai", modelID: "gpt-4o" },
      modelVariant: "fast",
      other: true,
    };

    expect(updateDefaultModelPrefs(previous, { providerID: "openai", modelID: "gpt-4o" })).toEqual({
      ...previous,
      defaultModel: { providerID: "openai", modelID: "gpt-4o" },
    });
    expect(updateDefaultModelPrefs(previous, { providerID: "anthropic", modelID: "claude" })).toEqual({
      ...previous,
      defaultModel: { providerID: "anthropic", modelID: "claude" },
      modelVariant: null,
    });
  });

  test("moves a draft model override to its created session", () => {
    const current = {
      "draft:ws_1": { providerID: "openai", modelID: "gpt-5" },
      ses_existing: { providerID: "anthropic", modelID: "claude" },
    };

    expect(moveSessionModelOverride(current, "draft:ws_1", "ses_new")).toEqual({
      ses_new: { providerID: "openai", modelID: "gpt-5" },
      ses_existing: { providerID: "anthropic", modelID: "claude" },
    });
    expect(moveSessionModelOverride(current, "draft:missing", "ses_new")).toBe(current);
  });

  test("moves new-session settings without leaving them on the draft", () => {
    const current = { "draft:ws_1": "full", ses_existing: "default" };

    expect(
      moveSessionScopedValue(current, "draft:ws_1", "ses_new", "full"),
    ).toEqual({
      ses_new: "full",
      ses_existing: "default",
    });
  });

  test("updates and clears only the targeted session-scoped value", () => {
    const current = { ses_one: "goal", ses_two: "plan" };
    expect(applySessionScopedValue(current, "ses_one", "paused")).toEqual({
      ses_one: "paused",
      ses_two: "plan",
    });
    expect(applySessionScopedValue(current, "ses_one", null)).toEqual({
      ses_two: "plan",
    });
  });

  test("clearing a session-scoped value preserves another draft session", () => {
    const current = { "draft:ws_1": "draft goal", ses_one: "active goal" };

    expect(removeSessionScopedValue(current, "ses_one")).toEqual({
      "draft:ws_1": "draft goal",
    });
  });

  test("uses the resolved workspace endpoint for attachment uploads", () => {
    expect(
      resolveAttachmentUploadTarget({
        fallbackClient: "local-client",
        fallbackWorkspaceId: "ws_local",
        workspaceClient: "remote-client",
        workspaceId: "rem_1",
      }),
    ).toEqual({ client: "remote-client", workspaceId: "rem_1" });
    expect(
      resolveAttachmentUploadTarget({
        fallbackClient: "local-client",
        fallbackWorkspaceId: " ws_local ",
        workspaceClient: null,
        workspaceId: null,
      }),
    ).toEqual({ client: "local-client", workspaceId: "ws_local" });
  });

  test("joins non-empty system prompt parts", () => {
    expect(joinSystemParts(["base", null, "", undefined, "mode"])).toBe("base\n\nmode");
    expect(joinSystemParts([null, "", undefined])).toBeUndefined();
  });

  test("builds language prompts from the current interface locale", () => {
    expect(buildLanguageSystemPrompt("zh")).toContain("简体中文");
    expect(buildLanguageSystemPrompt("zh-TW")).toContain("繁體中文");
    expect(buildLanguageSystemPrompt("en")).toContain("English");
  });

  test("keeps the interface locale authoritative even when the input is another language", () => {
    expect(buildLanguageSystemPrompt("zh")).toContain("必须使用简体中文");
    expect(buildLanguageSystemPrompt("zh")).toContain("不得因用户输入或引用的语言而改变");
    expect(buildLanguageSystemPrompt("en")).toContain("must be written in English");
    expect(buildLanguageSystemPrompt("en")).toContain("must not change because of the language used in the user's input");
  });

  test("bounds each goal runtime request to one agent turn", () => {
    setLocale("zh");
    const prompt = buildGoalRuntimeSystemPrompt({ objective: "完成确认" });
    expect(prompt).toContain("仅执行一轮");
    expect(prompt).not.toContain("跨轮次持续围绕目标推进");
    setLocale("en");
  });

  test("resolves assistant send plans for new and existing sessions", () => {
    expect(
      resolveDraftSendPlan({
        selectedSessionId: null,
        forceNewSession: false,
        pageMode: "assistant",
        assistantDraftWorkspaceRoot: " /tmp/assistant ",
        sessionWorkspaceRoot: "/tmp/session",
      }),
    ).toEqual({
      needsNewSession: true,
      initialSessionId: null,
      explicitAssistantWorkspace: "/tmp/assistant",
      taskWorkspaceRoot: "/tmp/assistant",
    });

    expect(
      resolveDraftSendPlan({
        selectedSessionId: "ses_1",
        forceNewSession: false,
        pageMode: "expert",
        assistantDraftWorkspaceRoot: "/tmp/assistant",
        sessionWorkspaceRoot: "/tmp/session",
      }),
    ).toEqual({
      needsNewSession: false,
      initialSessionId: "ses_1",
      explicitAssistantWorkspace: "",
      taskWorkspaceRoot: "/tmp/session",
    });
  });

  test("uses picked draft workspace for new expert sessions without assistant workspace registration", () => {
    expect(
      resolveDraftSendPlan({
        selectedSessionId: "ses_existing",
        forceNewSession: true,
        pageMode: "expert",
        assistantDraftWorkspaceRoot: " /tmp/expert-code ",
        sessionWorkspaceRoot: "/tmp/session",
      }),
    ).toEqual({
      needsNewSession: true,
      initialSessionId: null,
      explicitAssistantWorkspace: "",
      taskWorkspaceRoot: "/tmp/expert-code",
    });
  });

  test("force-new from a space-bound assistant session inherits the space directory", () => {
    expect(
      resolveDraftSendPlan({
        selectedSessionId: "ses_space",
        forceNewSession: true,
        pageMode: "assistant",
        assistantDraftWorkspaceRoot: "",
        sessionWorkspaceRoot: "/tmp/workspace-root",
        inheritAssistantWorkspaceDirectory: " /tmp/spaces/test1 ",
      }),
    ).toEqual({
      needsNewSession: true,
      initialSessionId: null,
      explicitAssistantWorkspace: "/tmp/spaces/test1",
      taskWorkspaceRoot: "/tmp/spaces/test1",
    });

    // Explicit draft folder still wins over inheritance.
    expect(
      resolveDraftSendPlan({
        selectedSessionId: "ses_space",
        forceNewSession: true,
        pageMode: "assistant",
        assistantDraftWorkspaceRoot: "/tmp/spaces/other",
        sessionWorkspaceRoot: "/tmp/workspace-root",
        inheritAssistantWorkspaceDirectory: "/tmp/spaces/test1",
      }).explicitAssistantWorkspace,
    ).toBe("/tmp/spaces/other");
  });

  test("idle auto-new does not fire while the selected session is busy", () => {
    const sessions: SidebarSessionItem[] = [
      {
        id: "ses_space",
        title: "询问模型身份",
        version: "0",
        time: { created: 1, updated: 1 },
      },
    ];
    const staleIdle = {
      enabled: true,
      idleHours: 1,
      selectedSessionId: "ses_space",
      sessions,
      // 2h after last listed update → would otherwise force-new
      nowMs: 1 + 2 * 60 * 60 * 1000,
    };
    expect(shouldForceNewSessionOnIdle({ ...staleIdle, sessionBusy: true })).toBe(
      false,
    );
    expect(shouldForceNewSessionOnIdle({ ...staleIdle, sessionBusy: false })).toBe(
      true,
    );
  });

  test("detects sendable draft content from resolved text or attachments", () => {
    expect(draftHasSendableContent(draft({ text: "  ", resolvedText: "hello" }))).toBe(true);
    expect(draftHasSendableContent(draft({ text: "  ", attachments: [attachment({ name: "a.txt", kind: "file" })] }))).toBe(true);
    expect(draftHasSendableContent(draft({ text: "  ", attachments: [] }))).toBe(false);
  });

  test("keeps access mode object identity when mode is unchanged", () => {
    const current = { ses_1: "full" as const };
    expect(applySessionAccessMode(current, "ses_1", "full")).toBe(current);
    expect(applySessionAccessMode(current, "ses_1", undefined)).toEqual({ ses_1: "default" });
  });

  test("uses session-scoped permission replies for each access mode", () => {
    expect(resolveAccessModePermissionReply("default")).toBeNull();
    expect(resolveAccessModePermissionReply("delegate", "read")).toBe("always");
    expect(resolveAccessModePermissionReply("delegate", "bash")).toBeNull();
    expect(resolveAccessModePermissionReply("delegate", "unknown")).toBeNull();
    expect(resolveAccessModePermissionReply("full")).toBe("always");
  });

  test("classifies only non-mutating known requests as low risk", () => {
    expect(isLowRiskPermission("read")).toBe(true);
    expect(isLowRiskPermission("skill")).toBe(true);
    expect(isLowRiskPermission("bash")).toBe(false);
    expect(isLowRiskPermission("edit")).toBe(false);
    expect(isLowRiskPermission("external_directory")).toBe(false);
    expect(isLowRiskPermission(undefined)).toBe(false);
  });

  test("clears consumed auto-approved permission notices only after the active request disappears", () => {
    const current = { ses_1: "perm_1", ses_2: "perm_2" };
    expect(clearConsumedPermissionNotice(current, "ses_1", "perm_1")).toBe(current);
    expect(clearConsumedPermissionNotice(current, null, "perm_1")).toBe(current);
    expect(clearConsumedPermissionNotice(current, "ses_missing", null)).toBe(current);
    expect(clearConsumedPermissionNotice(current, "ses_1", null)).toEqual({
      ses_2: "perm_2",
    });
    expect(clearConsumedPermissionNotice(current, "ses_1", "perm_other")).toEqual({
      ses_2: "perm_2",
    });
  });

  test("builds collaboration prompts for Craft, Ask, Plan, and legacy planning mode", () => {
    expect(buildCollaborationModeSystemPrompt({ planning: false, pursueGoal: false })).toBeNull();
    setLocale("zh");
    const craftPrompt = buildCollaborationModeSystemPrompt({ kind: "craft", planning: false, pursueGoal: true });
    expect(craftPrompt).toContain("Craft 协作模式");
    expect(craftPrompt).not.toContain("追求目标");
    expect(buildCollaborationModeSystemPrompt({ kind: "ask", planning: false, pursueGoal: false })).toContain("Ask 协作模式");
    expect(buildCollaborationModeSystemPrompt({ kind: "plan", planning: true, pursueGoal: false })).toContain("Plan 协作模式");
    expect(buildCollaborationModeSystemPrompt({ planning: true, pursueGoal: false })).toContain("Plan 协作模式");
    expect(buildCollaborationModeSystemPrompt({ planning: false, pursueGoal: true })).toContain("追求目标");
    setLocale("en");
    expect(buildCollaborationModeSystemPrompt({ kind: "ask", planning: false, pursueGoal: false })).toContain("Ask mode");
  });

  test("allows read-only tools and disables side-effect tools while drafting a plan", () => {
    const tools = resolveComposerRuntimeTools(
      {
        customCalendarTool: true,
        existingDisabledTool: false,
      },
      { kind: "plan", planning: true, pursueGoal: false },
    );

    expect(tools).toMatchObject({
      BrowserNavigate: false,
      BashFunc: false,
      EditFileFunc: false,
      ReadFileFunc: true,
      Read: true,
      Skill: false,
      Task: false,
      TodoWrite: false,
      Write: false,
      WriteFileFunc: false,
      browser_list: false,
      browser_navigate: false,
      bash_func: false,
      customCalendarTool: false,
      existingDisabledTool: false,
      edit_file_func: false,
      gitnexus_cypher: false,
      gitnexus_list_repos: false,
      onmyagent_extension_call: false,
      onmyagent_list_actions: false,
      opencode_router: false,
      opencode_router_send: false,
      read_file_func: true,
      read: true,
      task: false,
      todowrite: false,
      write_file_func: false,
    });
  });

  test("enables default execution tools in craft mode while preserving overrides", () => {
    const tools = { customCalendarTool: true, bash: false };
    expect(resolveComposerRuntimeTools(tools, { kind: "craft", planning: false, pursueGoal: true })).toMatchObject({
      Write: true,
      write_file_func: true,
      task: true,
      customCalendarTool: true,
      bash: false,
    });
  });

  test("uses read-only runtime tools in ask mode", () => {
    const tools = { customCalendarTool: true, read: false };
    expect(resolveComposerRuntimeTools(tools, { kind: "ask", planning: false, pursueGoal: false })).toMatchObject({
      customCalendarTool: false,
      read: false,
      Read: true,
      Write: false,
      BashFunc: false,
      Task: false,
    });
  });

  test("normalizes upload and inbox paths", () => {
    expect(sanitizeUploadFilename(" ../folder\\name.txt ")).toBe("..-folder-name.txt");
    expect(sanitizeUploadFilename("   ")).toBe("attachment");
    expect(inboxRelativePath("nested//file.txt")).toBe(".opencode/onmyagent/inbox/nested/file.txt");
    expect(inboxAbsolutePath("/tmp/workspace/", "nested//file.txt")).toBe(
      "/tmp/workspace/.opencode/onmyagent/inbox/nested/file.txt",
    );
  });

  test("converts text, agent, and file draft parts to SDK parts", async () => {
    const parts = await draftToParts(
      draft({
        parts: [
          { type: "text", text: "hello" },
          { type: "paste", label: "paste", text: "pasted", lines: 1 },
          { type: "agent", name: "builder" },
          { type: "file", path: "docs/spec.md" },
          { type: "file", path: "   " },
        ],
      }),
      "/tmp/workspace",
    );

    expect(parts).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "pasted" },
      { type: "agent", name: "builder" },
      {
        type: "file",
        mime: "text/plain",
        url: "file:///tmp/workspace/docs/spec.md",
        filename: "spec.md",
      },
    ]);
  });

  test("uploads non-native attachments and appends local path instructions", async () => {
    const uploaded: Array<{ name: string; path: string }> = [];
    const parts = await draftToParts(
      draft({ attachments: [attachment({ name: "report.pdf", kind: "file", mimeType: "application/pdf" })] }),
      "/tmp/workspace",
      {
        uploadAttachment: async (item, uploadPath) => {
          uploaded.push({ name: item.name, path: uploadPath });
          return { path: "session-uploads/report.pdf" };
        },
      },
    );

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.path).toContain("session-uploads/");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(parts[0]?.text).toContain("report.pdf (application/pdf)");
    expect(parts[0]?.text).toContain("/tmp/workspace/.opencode/onmyagent/inbox/session-uploads/report.pdf");
  });
});
