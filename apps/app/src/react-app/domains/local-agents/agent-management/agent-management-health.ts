import type { StatusBadgeTone } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import type {
  AgentManagementAgent,
  PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";

export type AgentManagementHealthResult = {
  status: "idle" | "running" | "passed" | "failed";
  at: number | null;
  runId: string | null;
  output: string;
  error: string | null;
};

export function summarizeAgentManagementHealth(run: PersonalLocalAgentRunResult): AgentManagementHealthResult {
  if (run.status === "running") {
    return {
      status: "running",
      at: Date.now(),
      runId: run.runId,
      output: run.output,
      error: run.error,
    };
  }
  return {
    status: run.status === "completed" ? "passed" : "failed",
    at: run.finishedAt ?? Date.now(),
    runId: run.runId,
    output: run.output,
    error: run.error,
  };
}

export function agentManagerStatusTone(status: string): StatusBadgeTone {
  if (status === "online") return "success";
  if (status === "offline") return "danger";
  return "warning";
}

export function formatAgentManagerTime(value: number | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAgentManagerDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function agentManagerHealthLabel(agent: AgentManagementAgent, health?: AgentManagementHealthResult) {
  if (health?.status === "running") return t("agent_manager.health_checking");
  if (health?.status === "passed") {
    return t("agent_manager.health_passed", { time: formatAgentManagerTime(health.at) });
  }
  if (health?.status === "failed") {
    return t("agent_manager.health_failed", { time: formatAgentManagerTime(health.at) });
  }
  if (agent.status === "online") return t("agent_manager.health_checkable");
  return t("agent_manager.health_not_checkable");
}

export function agentManagerHealthTone(agent: AgentManagementAgent, health?: AgentManagementHealthResult): StatusBadgeTone {
  if (health?.status === "running") return "accent";
  if (health?.status === "passed") return "success";
  if (health?.status === "failed" || agent.status !== "online") return "danger";
  return "neutral";
}
