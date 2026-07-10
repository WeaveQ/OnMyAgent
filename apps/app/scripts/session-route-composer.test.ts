import { describe, expect, test } from "bun:test";

import {
  applySessionAccessMode,
  buildCollaborationModeSystemPrompt,
  buildLanguageSystemPrompt,
  clearConsumedPermissionNotice,
  draftHasSendableContent,
  draftToParts,
  inboxAbsolutePath,
  inboxRelativePath,
  joinSystemParts,
  resolveLanguageForUserInput,
  resolveComposerRuntimeTools,
  resolveAccessModePermissionReply,
  resolveDraftSendPlan,
  routeForSettingsSection,
  sanitizeUploadFilename,
  updateDefaultModelPrefs,
} from "../src/react-app/shell/session-route-composer";
import type { ComposerAttachment, ComposerDraft } from "../src/app/types";
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
    expect(routeForSettingsSection("commands")).toBe("/settings/general");
    expect(routeForSettingsSection("skills")).toBe("/settings/skills");
    expect(routeForSettingsSection("mcps")).toBe("/settings/extensions/mcp");
    expect(routeForSettingsSection("plugins")).toBe("/settings/extensions/plugins");
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

  test("joins non-empty system prompt parts", () => {
    expect(joinSystemParts(["base", null, "", undefined, "mode"])).toBe("base\n\nmode");
    expect(joinSystemParts([null, "", undefined])).toBeUndefined();
  });

  test("builds language prompts from the current interface locale", () => {
    expect(buildLanguageSystemPrompt("zh")).toContain("简体中文");
    expect(buildLanguageSystemPrompt("zh-TW")).toContain("繁體中文");
    expect(buildLanguageSystemPrompt("en")).toContain("English");
  });

  test("prefers the latest user input language over the interface locale", () => {
    expect(resolveLanguageForUserInput("创建一个项目管理工具", "en")).toBe("zh");
    expect(resolveLanguageForUserInput("建立一個專案管理工具", "zh-TW")).toBe("zh-TW");
    expect(resolveLanguageForUserInput("Build a project manager", "en")).toBe("en");
    expect(buildLanguageSystemPrompt("zh", "user-input")).toContain("用户本轮输入");
    expect(buildLanguageSystemPrompt("zh", "user-input")).toContain("Todo 项");
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

  test("uses one-time permission replies for full access", () => {
    expect(resolveAccessModePermissionReply("default")).toBeNull();
    expect(resolveAccessModePermissionReply("full")).toBe("once");
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
