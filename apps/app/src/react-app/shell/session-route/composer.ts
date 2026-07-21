import type { AgentPartInput, FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client";
import type {
  ComposerAccessMode,
  ComposerAttachment,
  ComposerDraft,
  ModelRef,
} from "../../../app/types";
export {
  isLowRiskSessionPermission as isLowRiskPermission,
  resolveAccessModePermissionReply,
} from "../../../app/lib/access-mode";
import { t, type Language } from "../../../i18n";

export type SettingsSection = "commands" | "skills" | "mcps" | "plugins";

/**
 * Map tool-menu "open settings" intents to settings routes.
 * MCP / connectors no longer live under Settings → Extensions (removed).
 * Skills & connectors use marketplace side panel from Composer; these routes
 * are only last-resort deep links and intentionally avoid dead extension pages.
 */
export function routeForSettingsSection(section: SettingsSection) {
  if (section === "skills") return "/settings/general";
  // mcps / plugins: custom MCP dialog + store connectors; never /settings/extensions*
  if (section === "mcps" || section === "plugins") return "/settings/general";
  return "/settings/general";
}

export function updateDefaultModelPrefs<T extends {
  defaultModel?: ModelRef | null;
  modelVariant?: string | null;
}>(previous: T, model: ModelRef): T {
  return {
    ...previous,
    defaultModel: model,
    modelVariant:
      previous.defaultModel?.providerID === model.providerID &&
      previous.defaultModel.modelID === model.modelID
        ? previous.modelVariant
        : null,
  };
}

export function moveSessionModelOverride(
  current: Record<string, ModelRef>,
  sourceSessionId: string,
  targetSessionId: string,
): Record<string, ModelRef> {
  const override = current[sourceSessionId];
  if (!override || !targetSessionId.trim()) return current;
  const next = { ...current, [targetSessionId]: override };
  delete next[sourceSessionId];
  return next;
}

export function moveSessionScopedValue<T>(
  current: Record<string, T>,
  sourceSessionId: string,
  targetSessionId: string,
  value: T,
): Record<string, T> {
  const source = sourceSessionId.trim();
  const target = targetSessionId.trim();
  if (!target) return current;
  const next = { ...current, [target]: value };
  if (source && source !== target) delete next[source];
  return next;
}

export function applySessionScopedValue<T>(
  current: Record<string, T>,
  sessionId: string,
  value: T | null,
): Record<string, T> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return current;
  if (value === null) {
    if (!(normalizedSessionId in current)) return current;
    const next = { ...current };
    delete next[normalizedSessionId];
    return next;
  }
  if (current[normalizedSessionId] === value) return current;
  return { ...current, [normalizedSessionId]: value };
}

export function removeSessionScopedValue<T>(
  current: Record<string, T>,
  sessionId: string,
): Record<string, T> {
  return applySessionScopedValue(current, sessionId, null);
}

export function resolveAttachmentUploadTarget<TClient>(input: {
  fallbackClient: TClient | null | undefined;
  fallbackWorkspaceId: string;
  workspaceClient: TClient | null | undefined;
  workspaceId: string | null | undefined;
}): { client: TClient; workspaceId: string } | null {
  const client = input.workspaceClient ?? input.fallbackClient;
  const workspaceId = (input.workspaceId ?? input.fallbackWorkspaceId).trim();
  return client && workspaceId ? { client, workspaceId } : null;
}

export function joinSystemParts(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part)).join("\n\n") || undefined;
}

export function buildLanguageSystemPrompt(locale: Language) {
  return t("session.language_system_prompt", locale);
}

export function deriveGoalSummary(objective: string) {
  const normalized = stripGoalSummaryPrefixes(objective
    .replace(/\[pasted text[^\]]*\]/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim());
  const sentence =
    normalized
      .split(/(?:。|！|？|\.|\n)/)
      .map((item) => item.trim())
      .find(Boolean) ?? normalized;
  if (sentence.length <= 56) return sentence;
  return `${sentence.slice(0, 56).trimEnd()}...`;
}

function stripGoalSummaryPrefixes(value: string) {
  let next = value.trim();
  for (let index = 0; index < 4; index += 1) {
    const previous = next;
    next = next
      .replace(/^(?:You|User|The user(?:\s+(?:wants|asked))?(?:\s+me)?(?:\s+to)?|Objective|Goal|Task)\s*(?::|\uff1a)?\s*/i, "")
      .replace(/^(?:\u76ee\u6807|\u4efb\u52a1|\u9879\u76ee\u8981\u6c42|\u9700\u6c42|\u7528\u6237\u8981\u6c42|\u7528\u6237\u5e0c\u671b)\s*[:\uff1a]?\s*/i, "")
      .replace(/^\d+[.)、]\s*/, "")
      .replace(/^[-*]\s*/, "")
      .trim();
    if (next === previous) return next;
  }
  return next;
}

export function resolveDraftSendPlan(input: {
  selectedSessionId: string | null;
  forceNewSession: boolean;
  pageMode: "assistant" | "expert";
  assistantDraftWorkspaceRoot: string;
  sessionWorkspaceRoot: string;
  /**
   * When force-new / idle-new from a space-bound session, pass that session's
   * project directory so the new chat stays under 空间 instead of dropping
   * into the unscoped 任务 list (and becoming "first task").
   */
  inheritAssistantWorkspaceDirectory?: string | null;
}) {
  const needsNewSession = !input.selectedSessionId || input.forceNewSession;
  const explicitDraftWorkspace = needsNewSession
    ? input.assistantDraftWorkspaceRoot.trim()
    : "";
  const inheritedWorkspace =
    needsNewSession && input.pageMode === "assistant"
      ? (input.inheritAssistantWorkspaceDirectory?.trim() || "")
      : "";
  // Prefer the draft-picked folder; else keep the previous session's space.
  // Expert force-new without a pick stays unbound so isolation path can run.
  const explicitAssistantWorkspace =
    input.pageMode === "assistant"
      ? explicitDraftWorkspace || inheritedWorkspace
      : explicitDraftWorkspace;
  return {
    needsNewSession,
    initialSessionId: needsNewSession ? null : input.selectedSessionId,
    explicitAssistantWorkspace,
    taskWorkspaceRoot:
      explicitDraftWorkspace ||
      inheritedWorkspace ||
      input.sessionWorkspaceRoot,
  };
}

export function resolveDraftText(draft: Pick<ComposerDraft, "resolvedText" | "text">) {
  return (draft.resolvedText ?? draft.text).trim();
}

export function draftHasSendableContent(draft: Pick<ComposerDraft, "attachments" | "resolvedText" | "text">) {
  return resolveDraftText(draft).length > 0 || draft.attachments.length > 0;
}

export function applySessionAccessMode(
  current: Record<string, ComposerAccessMode>,
  sessionId: string,
  accessMode: ComposerAccessMode | undefined,
): Record<string, ComposerAccessMode> {
  const nextAccessMode = accessMode ?? "default";
  return current[sessionId] === nextAccessMode
    ? current
    : { ...current, [sessionId]: nextAccessMode };
}

export function clearConsumedPermissionNotice(
  current: Record<string, string>,
  sessionId: string | null,
  activePermissionId: string | null | undefined,
) {
  if (!sessionId) return current;
  const noticeId = current[sessionId];
  if (!noticeId || noticeId === activePermissionId) return current;
  const next = { ...current };
  delete next[sessionId];
  return next;
}

export async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error(`Failed to read attachment: ${file.name}`));
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

export function isModelNativeAttachment(attachment: ComposerAttachment) {
  return attachment.kind === "image" && attachment.mimeType.startsWith("image/");
}

export function sanitizeUploadFilename(name: string) {
  const normalized = name.trim().replace(/[/\\]+/g, "-");
  return normalized || "attachment";
}

export function inboxRelativePath(path: string) {
  return `.opencode/onmyagent/inbox/${path}`.replace(/\/+/g, "/");
}

export function inboxAbsolutePath(workspaceRoot: string, path: string) {
  const root = workspaceRoot.trim();
  if (!root) return inboxRelativePath(path);
  return `${root}/${inboxRelativePath(path)}`.replace(/\/+/g, "/");
}

export function buildCollaborationModeSystemPrompt(
  mode: ComposerDraft["collaborationMode"],
) {
  if (!mode) return null;
  const kind =
    mode.kind === "craft" || mode.kind === "ask" || mode.kind === "plan"
      ? mode.kind
      : mode.planning
        ? "plan"
        : null;
  const instructions: string[] = [];
  if (kind === "craft") {
    instructions.push(
      t("session.collaboration_craft_system"),
    );
  }
  if (kind === "ask") {
    instructions.push(
      t("session.collaboration_ask_system"),
    );
  }
  if (kind === "plan") {
    instructions.push(
      t("session.collaboration_plan_system"),
    );
    instructions.push(
      t("session.collaboration_plan_hard_gate"),
    );
    instructions.push(
      t("session.collaboration_plan_response_gate"),
    );
  }
  if (isComposerGoalMode(mode)) {
    instructions.push(
      t("session.collaboration_goal_system"),
    );
  }
  if (instructions.length === 0) return null;
  return `${t("session.collaboration_system_title")}\n${instructions.map((instruction) => `- ${instruction}`).join("\n")}`;
}

export function isComposerPlanningMode(
  mode: ComposerDraft["collaborationMode"],
) {
  if (!mode) return false;
  return mode.kind === "plan" || Boolean(mode.planning);
}

export function isComposerAskMode(
  mode: ComposerDraft["collaborationMode"],
) {
  if (!mode) return false;
  return mode.kind === "ask" && !mode.planning && mode.pursueGoal !== true;
}

export function isComposerGoalMode(
  mode: ComposerDraft["collaborationMode"],
) {
  if (!mode) return false;
  return mode.kind !== "craft" && !mode.planning && mode.pursueGoal === true;
}

const PLAN_MODE_DISABLED_TOOLS = [
  "Bash",
  "BashFunc",
  "Browser",
  "BrowserEval",
  "BrowserNavigate",
  "BrowserScreenshot",
  "Edit",
  "EditFileFunc",
  "MultiEdit",
  "NotebookEdit",
  "Shell",
  "Skill",
  "SkillLoad",
  "Task",
  "Terminal",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
  "WriteFileFunc",
  "apply_patch",
  "bash",
  "bash_func",
  "browser",
  "browser_click",
  "browser_eval",
  "browser_fill",
  "browser_list",
  "browser_navigate",
  "browser_select",
  "browser_screenshot",
  "browser_snapshot",
  "browser_version",
  "create_file",
  "create_file_func",
  "delete_file",
  "delete_file_func",
  "edit",
  "edit_file",
  "edit_file_func",
  "extension",
  "gitnexus",
  "gitnexus_analyze",
  "gitnexus_context",
  "gitnexus_cypher",
  "gitnexus_detect_changes",
  "gitnexus_explain",
  "gitnexus_impact",
  "gitnexus_list_repos",
  "gitnexus_path",
  "gitnexus_paths",
  "gitnexus_query",
  "gitnexus_rename",
  "gitnexus_search",
  "gitnexus_status",
  "gitnexus_*",
  "load_skill",
  "mcp",
  "multi_edit",
  "multiedit",
  "move_file",
  "onmyagent_extension_list_actions",
  "onmyagent_extension_call",
  "onmyagent_list_actions",
  "opencode_router",
  "opencode_router_call",
  "opencode_router_route",
  "opencode_router_send",
  "opencode_router_status",
  "patch",
  "shell",
  "skill",
  "skill_load",
  "str_replace_editor",
  "task",
  "terminal",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
  "write_file",
  "write_file_func",
] as const;

const PLAN_MODE_READONLY_TOOLS = [
  "Glob",
  "Grep",
  "List",
  "ListFileFunc",
  "Read",
  "ReadFileFunc",
  "TodoRead",
  "glob",
  "grep",
  "list",
  "list_file_func",
  "read",
  "read_file_func",
  "todoread",
] as const;

const DEFAULT_EXECUTION_TOOLS: Record<string, boolean> = {
  Bash: true,
  BashFunc: true,
  Edit: true,
  EditFileFunc: true,
  Glob: true,
  Grep: true,
  List: true,
  ListFileFunc: true,
  MultiEdit: true,
  Read: true,
  ReadFileFunc: true,
  Task: true,
  TodoRead: true,
  TodoWrite: true,
  WebFetch: true,
  WebSearch: true,
  Write: true,
  WriteFileFunc: true,
  apply_patch: true,
  bash: true,
  bash_func: true,
  create_file: true,
  create_file_func: true,
  edit: true,
  edit_file: true,
  edit_file_func: true,
  glob: true,
  grep: true,
  list: true,
  list_file_func: true,
  multi_edit: true,
  multiedit: true,
  patch: true,
  read: true,
  read_file_func: true,
  task: true,
  todoread: true,
  todowrite: true,
  webfetch: true,
  websearch: true,
  write: true,
  write_file: true,
  write_file_func: true,
};

function resolveReadonlyRuntimeTools(tools: Record<string, boolean> | undefined) {
  const next: Record<string, boolean> = {};
  for (const toolName of PLAN_MODE_DISABLED_TOOLS) {
    next[toolName] = false;
  }
  for (const toolName of Object.keys(tools ?? {})) {
    next[toolName] = false;
  }
  for (const toolName of PLAN_MODE_READONLY_TOOLS) {
    next[toolName] = tools?.[toolName] === false ? false : true;
  }
  return next;
}

export function resolveComposerRuntimeTools(
  tools: Record<string, boolean> | undefined,
  mode: ComposerDraft["collaborationMode"],
) {
  if (isComposerAskMode(mode)) return resolveReadonlyRuntimeTools(tools);
  if (!isComposerPlanningMode(mode)) {
    if (mode?.kind !== "craft" && !isComposerGoalMode(mode)) return tools;
    return {
      ...DEFAULT_EXECUTION_TOOLS,
      ...(tools ?? {}),
    };
  }
  return resolveReadonlyRuntimeTools(tools);
}

export function buildGoalRuntimeSystemPrompt(
  input: { objective: string; status?: string } | null | undefined,
) {
  const objective = input?.objective.trim();
  if (!objective) return null;
  return [
    t("session.goal_runtime_system_title"),
    t("session.goal_runtime_system_objective", { objective }),
    t("session.goal_runtime_system_success"),
    t("session.goal_runtime_system_next_step"),
    t("session.goal_runtime_system_turn_boundary"),
    t("session.goal_runtime_system_progress"),
    `- ${t("session.goal_hidden_stall_recovery")}`,
    t("session.goal_runtime_system_blocker"),
  ].join("\n");
}

export function buildAccessModeSystemPrompt(
  mode: ComposerDraft["accessMode"],
) {
  if (mode === "full") {
    return [
      t("session.access_mode_full_system_title"),
      t("session.access_mode_full_system_body"),
    ].join("\n");
  }
  if (mode === "delegate") {
    return [
      t("session.access_mode_delegate_system_title"),
      t("session.access_mode_delegate_system_body"),
    ].join("\n");
  }
  return [
    t("session.access_mode_default_system_title"),
    t("session.access_mode_default_system_body"),
  ].join("\n");
}

export async function draftToParts(
  draft: ComposerDraft,
  workspaceRoot: string,
  options?: {
    uploadAttachment?: (
      attachment: ComposerAttachment,
      uploadPath: string,
    ) => Promise<{ path: string }>;
  },
) {
  const parts: Array<TextPartInput | FilePartInput | AgentPartInput> = [];
  const root = workspaceRoot.trim();

  const toAbsolutePath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("/")) return trimmed;
    if (/^[a-zA-Z]:\\/.test(trimmed)) return trimmed;
    if (!root) return "";
    return `${root}/${trimmed}`.replace(/\/\/+/g, "/");
  };

  const filenameFromPath = (path: string) => {
    const normalized = path.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "file";
  };

  for (const part of draft.parts) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "paste") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "agent") {
      parts.push({ type: "agent", name: part.name });
      continue;
    }
    if (part.type === "file") {
      const absolute = toAbsolutePath(part.path);
      if (!absolute) continue;
      parts.push({
        type: "file",
        mime: "text/plain",
        url: `file://${absolute}`,
        filename: filenameFromPath(part.path),
      });
    }
  }

  const uploadedFiles: Array<{
    name: string;
    mimeType: string;
    relativePath: string;
    absolutePath: string;
  }> = [];

  for (const [index, attachment] of draft.attachments.entries()) {
    if (isModelNativeAttachment(attachment) || !options?.uploadAttachment) {
      parts.push({
        type: "file",
        url: await fileToDataUrl(attachment.file),
        filename: attachment.name,
        mime: attachment.mimeType,
      });
      continue;
    }

    const uploadPath = `session-uploads/${Date.now()}-${index}-${sanitizeUploadFilename(attachment.name)}`;
    const uploaded = await options.uploadAttachment(attachment, uploadPath);
    uploadedFiles.push({
      name: attachment.name,
      mimeType: attachment.mimeType,
      relativePath: inboxRelativePath(uploaded.path),
      absolutePath: inboxAbsolutePath(root, uploaded.path),
    });
  }

  if (uploadedFiles.length > 0) {
    parts.push({
      type: "text",
      text: [
        "The user uploaded the following files. Do not treat them as native model file inputs; if the task needs to process files, use local tools or the configured skill and read these local paths directly:",
        ...uploadedFiles.map(
          (file) =>
            `- ${file.name} (${file.mimeType || "application/octet-stream"}): ${file.absolutePath} (workspace-relative path: ${file.relativePath})`,
        ),
      ].join("\n"),
    });
  }

  return parts;
}
