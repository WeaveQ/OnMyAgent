import type { UIMessage } from "ai";

import { t } from "../../../../../i18n";
import type { SessionActivityStatus } from "../../status/session-activity-store";
import { readTranscriptMessageMetadata } from "../../sync/message-metadata";

export type AssistantActivityPhase =
  | "idle"
  | "preparing"
  | "model-requesting"
  | "model-streaming"
  | "model-done"
  | "retrying"
  | "tool-preparing"
  | "tool-executing"
  | "waiting-permission"
  | "waiting-user"
  | "compacting"
  | "error";

export type AssistantToolIntent =
  | "read"
  | "edit"
  | "command"
  | "search"
  | "web"
  | "task"
  | "skill"
  | "visual"
  | "todo"
  | "memory"
  | "analysis"
  | "computer"
  | "message"
  | "workspace"
  | "schedule"
  | "cloud"
  | "automation"
  | "delivery"
  | "result"
  | "structured"
  | "question"
  | "generic";

export type AssistantActivity = {
  phase: AssistantActivityPhase;
  toolIntent: AssistantToolIntent | null;
};

type AssistantActivityInput = {
  status: SessionActivityStatus;
  sending: boolean;
  hasActivePermission: boolean;
  hasActiveQuestion: boolean;
  messages: UIMessage[];
};

function toolNameFromPart(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  return "";
}

function classifyToolIntent(toolName: string): AssistantToolIntent {
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.includes("todo")) return "todo";
  if (normalized.includes("memory")) return "memory";
  if (
    normalized === "lsp" ||
    normalized.includes("diagnostic") ||
    normalized.includes("analyzecode")
  ) return "analysis";
  if (normalized.includes("computeruse")) return "computer";
  if (
    normalized.includes("sendmessage") ||
    normalized.includes("wechatreply") ||
    normalized.includes("wecomreply")
  ) return "message";
  if (normalized.includes("worktree")) return "workspace";
  if (normalized.includes("cron") || normalized.includes("schedule")) return "schedule";
  if (normalized.includes("cloud") || normalized.includes("connectservice")) return "cloud";
  if (normalized.includes("automation")) return "automation";
  if (normalized.includes("deliver") || normalized.includes("attachment")) return "delivery";
  if (normalized.includes("openresult") || normalized.includes("previewurl")) return "result";
  if (normalized.includes("structuredoutput")) return "structured";
  if (
    normalized.includes("visual") ||
    normalized.includes("widget") ||
    normalized.includes("image") ||
    normalized.includes("chart")
  ) return "visual";
  if (
    normalized.includes("web") ||
    normalized.includes("browser") ||
    normalized.includes("url") ||
    normalized.includes("http")
  ) return "web";
  if (
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("append") ||
    normalized.includes("replace")
  ) return "edit";
  if (
    normalized === "bash" ||
    normalized.includes("shell") ||
    normalized.includes("terminal") ||
    normalized.includes("command") ||
    normalized.includes("powershell") ||
    normalized.includes("exec")
  ) return "command";
  if (
    normalized.includes("grep") ||
    normalized.includes("glob") ||
    normalized.includes("search") ||
    normalized === "ls" ||
    normalized.includes("listfiles")
  ) return "search";
  if (
    normalized.includes("read") ||
    normalized.includes("file") ||
    normalized.includes("resource")
  ) return "read";
  if (
    normalized.includes("agent") ||
    normalized.includes("task") ||
    normalized.includes("delegate") ||
    normalized.includes("team") ||
    normalized.includes("worktree")
  ) return "task";
  if (normalized.includes("skill")) return "skill";
  if (normalized.includes("question") || normalized.includes("askuser")) return "question";
  return "generic";
}

function activeToolActivity(messages: UIMessage[]): AssistantActivity | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (!part || (part.type !== "dynamic-tool" && !part.type.startsWith("tool-"))) {
        continue;
      }
      if (!("state" in part)) return null;
      const toolIntent = classifyToolIntent(toolNameFromPart(part));
      if (part.state === "input-streaming") {
        return { phase: "tool-preparing", toolIntent };
      }
      if (part.state === "input-available" || part.state === "approval-responded") {
        return { phase: "tool-executing", toolIntent };
      }
      return null;
    }
  }
  return null;
}

function latestToolIntent(messages: UIMessage[]): AssistantToolIntent | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (!part || (part.type !== "dynamic-tool" && !part.type.startsWith("tool-"))) continue;
      return classifyToolIntent(toolNameFromPart(part));
    }
  }
  return null;
}

function hasCompletedFinalAssistantText(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "user") return false;
    if (message.role !== "assistant") continue;
    const hasText = message.parts.some(
      (part) => part.type === "text" && part.text.trim().length > 0,
    );
    return hasText && readTranscriptMessageMetadata(message.metadata).completed !== null;
  }
  return false;
}

export function deriveAssistantActivity(input: AssistantActivityInput): AssistantActivity {
  if (input.status === "error") return { phase: "error", toolIntent: null };
  if (input.status === "compacting") return { phase: "compacting", toolIntent: null };
  if (input.status === "retrying") return { phase: "retrying", toolIntent: null };
  if (input.hasActivePermission) {
    return {
      phase: "waiting-permission",
      toolIntent: latestToolIntent(input.messages),
    };
  }
  if (input.hasActiveQuestion) {
    return {
      phase: "waiting-user",
      toolIntent: latestToolIntent(input.messages) ?? "question",
    };
  }
  if (input.status === "idle") return { phase: "idle", toolIntent: null };
  if (input.status === "thinking") {
    return {
      phase: input.sending ? "preparing" : "model-requesting",
      toolIntent: null,
    };
  }
  const activeTool = activeToolActivity(input.messages);
  if (activeTool) return activeTool;
  if (input.status === "waiting") {
    return { phase: "model-requesting", toolIntent: null };
  }
  if (hasCompletedFinalAssistantText(input.messages)) {
    return { phase: "model-done", toolIntent: null };
  }
  return { phase: "model-streaming", toolIntent: null };
}

export function deriveAssistantActivityPhase(input: AssistantActivityInput): AssistantActivityPhase {
  return deriveAssistantActivity(input).phase;
}

function toolActivityLabel(phase: "tool-preparing" | "tool-executing", intent: AssistantToolIntent) {
  if (phase === "tool-preparing") {
    if (intent === "read") return t("session.assistant_phase_preparing_read");
    if (intent === "edit") return t("session.assistant_phase_preparing_edit");
    if (intent === "command") return t("session.assistant_phase_preparing_command");
    if (intent === "search") return t("session.assistant_phase_preparing_search");
    if (intent === "web") return t("session.assistant_phase_preparing_web");
    if (intent === "task") return t("session.assistant_phase_preparing_task");
    if (intent === "skill") return t("session.assistant_phase_preparing_skill");
    if (intent === "visual") return t("session.assistant_phase_preparing_visual");
    if (intent === "todo") return t("session.assistant_phase_preparing_todo");
    if (intent === "memory") return t("session.assistant_phase_preparing_memory");
    if (intent === "analysis") return t("session.assistant_phase_preparing_analysis");
    if (intent === "computer") return t("session.assistant_phase_preparing_computer");
    if (intent === "message") return t("session.assistant_phase_preparing_message");
    if (intent === "workspace") return t("session.assistant_phase_preparing_workspace");
    if (intent === "schedule") return t("session.assistant_phase_preparing_schedule");
    if (intent === "cloud") return t("session.assistant_phase_preparing_cloud");
    if (intent === "automation") return t("session.assistant_phase_preparing_automation");
    if (intent === "delivery") return t("session.assistant_phase_preparing_delivery");
    if (intent === "result") return t("session.assistant_phase_preparing_result");
    if (intent === "structured") return t("session.assistant_phase_preparing_structured");
    if (intent === "question") return t("session.assistant_phase_preparing_question");
    return t("session.assistant_phase_tool_preparing");
  }
  if (intent === "read") return t("session.assistant_phase_executing_read");
  if (intent === "edit") return t("session.assistant_phase_executing_edit");
  if (intent === "command") return t("session.assistant_phase_executing_command");
  if (intent === "search") return t("session.assistant_phase_executing_search");
  if (intent === "web") return t("session.assistant_phase_executing_web");
  if (intent === "task") return t("session.assistant_phase_executing_task");
  if (intent === "skill") return t("session.assistant_phase_executing_skill");
  if (intent === "visual") return t("session.assistant_phase_executing_visual");
  if (intent === "todo") return t("session.assistant_phase_executing_todo");
  if (intent === "memory") return t("session.assistant_phase_executing_memory");
  if (intent === "analysis") return t("session.assistant_phase_executing_analysis");
  if (intent === "computer") return t("session.assistant_phase_executing_computer");
  if (intent === "message") return t("session.assistant_phase_executing_message");
  if (intent === "workspace") return t("session.assistant_phase_executing_workspace");
  if (intent === "schedule") return t("session.assistant_phase_executing_schedule");
  if (intent === "cloud") return t("session.assistant_phase_executing_cloud");
  if (intent === "automation") return t("session.assistant_phase_executing_automation");
  if (intent === "delivery") return t("session.assistant_phase_executing_delivery");
  if (intent === "result") return t("session.assistant_phase_executing_result");
  if (intent === "structured") return t("session.assistant_phase_executing_structured");
  if (intent === "question") return t("session.assistant_phase_executing_question");
  return t("session.assistant_phase_tool_executing");
}

export function getAssistantActivityPhaseLabel(activity: AssistantActivity | AssistantActivityPhase) {
  const phase = typeof activity === "string" ? activity : activity.phase;
  const toolIntent = typeof activity === "string" ? null : activity.toolIntent;
  if (phase === "preparing") return t("session.assistant_phase_preparing");
  if (phase === "model-requesting") return t("session.assistant_phase_model_requesting");
  if (phase === "model-streaming") return t("session.assistant_phase_model_streaming");
  if (phase === "model-done") return t("session.assistant_phase_model_done");
  if (phase === "retrying") return t("session.assistant_retrying");
  if (phase === "tool-preparing" || phase === "tool-executing") {
    return toolActivityLabel(phase, toolIntent ?? "generic");
  }
  if (phase === "waiting-permission") {
    if (toolIntent === "command") return t("session.assistant_phase_waiting_permission_command");
    if (toolIntent === "edit") return t("session.assistant_phase_waiting_permission_edit");
    if (toolIntent === "web") return t("session.assistant_phase_waiting_permission_web");
    if (toolIntent === "task") return t("session.assistant_phase_waiting_permission_task");
    if (toolIntent === "skill") return t("session.assistant_phase_waiting_permission_skill");
    if (toolIntent === "visual") return t("session.assistant_phase_waiting_permission_visual");
    return t("session.assistant_phase_waiting_permission");
  }
  if (phase === "waiting-user") {
    if (toolIntent === "command") return t("session.assistant_phase_waiting_user_command");
    return t("session.assistant_phase_waiting_user");
  }
  if (phase === "compacting") return t("session.assistant_compacting");
  if (phase === "error") return t("session.assistant_error");
  return t("session.assistant_idle");
}
