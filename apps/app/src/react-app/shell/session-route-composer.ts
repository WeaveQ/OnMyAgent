import type { AgentPartInput, FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client";
import type { ComposerAttachment, ComposerDraft, ModelRef } from "../../app/types";
import type { Language } from "../../i18n";

export type SettingsSection = "commands" | "skills" | "mcps" | "plugins";

export function routeForSettingsSection(section: SettingsSection) {
  if (section === "skills") return "/settings/skills";
  if (section === "mcps") return "/settings/extensions/mcp";
  if (section === "plugins") return "/settings/extensions/plugins";
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

export function joinSystemParts(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part)).join("\n\n") || undefined;
}

export function buildLanguageSystemPrompt(locale: Language) {
  if (locale === "zh") {
    return [
      "语言偏好：当前界面语言是简体中文。",
      "除非用户明确要求其他语言，面向用户的回答、思考过程摘要、计划、状态说明和总结都尽量使用简体中文。",
      "代码、命令、文件名、API 名称、专有名词和引用原文可以保留原语言。",
    ].join("\n");
  }
  if (locale === "zh-TW") {
    return [
      "語言偏好：目前介面語言是繁體中文。",
      "除非使用者明確要求其他語言，面向使用者的回答、思考過程摘要、計劃、狀態說明和總結都盡量使用繁體中文。",
      "程式碼、命令、檔案名稱、API 名稱、專有名詞和引用原文可以保留原語言。",
    ].join("\n");
  }
  return [
    "Language preference: the current interface language is English.",
    "Unless the user explicitly asks for another language, write user-facing answers, reasoning/progress summaries, plans, status notes, and final summaries in English.",
    "Code, commands, file names, API names, proper nouns, and quoted source text may remain in their original language.",
  ].join("\n");
}

export function resolveDraftSendPlan(input: {
  selectedSessionId: string | null;
  forceNewSession: boolean;
  pageMode: "assistant" | "expert";
  assistantDraftWorkspaceRoot: string;
  sessionWorkspaceRoot: string;
}) {
  const needsNewSession = !input.selectedSessionId || input.forceNewSession;
  const explicitDraftWorkspace = needsNewSession
    ? input.assistantDraftWorkspaceRoot.trim()
    : "";
  const explicitAssistantWorkspace =
    input.pageMode === "assistant"
      ? explicitDraftWorkspace
      : "";
  return {
    needsNewSession,
    initialSessionId: needsNewSession ? null : input.selectedSessionId,
    explicitAssistantWorkspace,
    taskWorkspaceRoot: explicitDraftWorkspace || input.sessionWorkspaceRoot,
  };
}

export function resolveDraftText(draft: Pick<ComposerDraft, "resolvedText" | "text">) {
  return (draft.resolvedText ?? draft.text).trim();
}

export function draftHasSendableContent(draft: Pick<ComposerDraft, "attachments" | "resolvedText" | "text">) {
  return resolveDraftText(draft).length > 0 || draft.attachments.length > 0;
}

export function applySessionAccessMode(
  current: Record<string, ComposerDraft["accessMode"] | "default">,
  sessionId: string,
  accessMode: ComposerDraft["accessMode"] | undefined,
) {
  const nextAccessMode = accessMode ?? "default";
  return current[sessionId] === nextAccessMode
    ? current
    : { ...current, [sessionId]: nextAccessMode };
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
      "Craft 协作模式：默认端到端推进用户目标；可以按需读取和修改文件、运行本地命令、管理任务、联网搜索并产出可交付结果。执行高风险或破坏性操作前先请求确认。",
    );
  }
  if (kind === "ask") {
    instructions.push(
      "Ask 协作模式：以问答和解释为主；默认只读取必要文件与上下文，不主动修改文件、不运行会产生副作用的命令、不创建任务。若需要写入、执行命令或改变外部状态，先向用户说明并请求确认。",
    );
  }
  if (kind === "plan") {
    instructions.push(
      "Plan 协作模式：先制定清晰的多步骤计划，说明目标、范围、风险、验证方式和下一步；默认只读取必要文件与上下文。除非用户明确要求执行计划，否则不要直接修改文件或运行有副作用的命令。",
    );
    instructions.push(
      "Plan mode hard gate: do not call tools, do not emit tool-call markup, and do not claim side effects are complete. Return a textual plan only until the user explicitly approves execution.",
    );
    instructions.push(
      "For this response, reinterpret the user's task request as a request to draft an approval plan. Start with a plan-ready heading, use future-tense action steps, and never say that files were created, commands were run, pages were opened, or work was completed.",
    );
  }
  if (kind === "craft" || mode.pursueGoal) {
    instructions.push(
      "追求目标：持续围绕用户目标推进，主动跟踪完成状态；遇到阻塞时说明阻塞并寻找可行替代路径。",
    );
  }
  if (instructions.length === 0) return null;
  return `协作模式系统提示词：\n${instructions.map((instruction) => `- ${instruction}`).join("\n")}`;
}

export function isComposerPlanningMode(
  mode: ComposerDraft["collaborationMode"],
) {
  if (!mode) return false;
  return mode.kind === "plan" || Boolean(mode.planning);
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
  "Glob",
  "Grep",
  "List",
  "ListFileFunc",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "ReadFileFunc",
  "Shell",
  "Skill",
  "SkillLoad",
  "Task",
  "Terminal",
  "TodoRead",
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
  "glob",
  "grep",
  "list",
  "list_file_func",
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
  "read",
  "read_file_func",
  "shell",
  "skill",
  "skill_load",
  "str_replace_editor",
  "task",
  "terminal",
  "todoread",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
  "write_file",
  "write_file_func",
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

export function resolveComposerRuntimeTools(
  tools: Record<string, boolean> | undefined,
  mode: ComposerDraft["collaborationMode"],
) {
  if (!isComposerPlanningMode(mode)) {
    if (mode?.kind !== "craft" && !isComposerGoalMode(mode)) return tools;
    return {
      ...DEFAULT_EXECUTION_TOOLS,
      ...(tools ?? {}),
    };
  }
  const next: Record<string, boolean> = {};
  for (const toolName of PLAN_MODE_DISABLED_TOOLS) {
    next[toolName] = false;
  }
  for (const toolName of Object.keys(tools ?? {})) {
    next[toolName] = false;
  }
  return next;
}

export function buildGoalRuntimeSystemPrompt(
  input: { objective: string; status?: string } | null | undefined,
) {
  const objective = input?.objective.trim();
  if (!objective) return null;
  return [
    "Active goal mode:",
    `- Objective: ${objective}`,
    "- Treat the objective as the persistent success criterion for this conversation.",
    "- Keep working toward that objective across turns until it is complete, paused, blocked, or the user clears the goal.",
    "- At the start of each run, decide the next concrete step based on what has already happened in the conversation.",
    "- Do not stop after partial progress when another safe, relevant step remains available.",
    "- Track what remains, verify results against the objective, and report concrete progress.",
    "- If you cannot continue without user input or an external change, say what is blocking the goal and what is needed next.",
  ].join("\n");
}

export function buildAccessModeSystemPrompt(
  mode: ComposerDraft["accessMode"],
) {
  if (mode === "full") {
    return [
      "Access mode: full access.",
      "The user has selected a high-trust mode. You may proceed with file edits, local commands, and network access when needed for the task, while still obeying the host runtime safety boundaries and asking before destructive or irreversible operations.",
    ].join("\n");
  }
  return [
    "Access mode: default.",
    "Treat file writes, local commands, network access, and external state changes as actions that may require host approval. Explain the need before taking high-risk or irreversible actions.",
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
        "用户上传了以下文件。不要把这些文件当作模型原生文件输入；如果任务需要处理文件，请使用本地工具或已配置的对应 skill，并直接读取这些本地路径：",
        ...uploadedFiles.map(
          (file) =>
            `- ${file.name} (${file.mimeType || "application/octet-stream"}): ${file.absolutePath}（工作区相对路径：${file.relativePath}）`,
        ),
      ].join("\n"),
    });
  }

  return parts;
}
