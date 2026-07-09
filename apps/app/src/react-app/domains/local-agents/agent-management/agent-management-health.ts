import type { StatusBadgeTone } from "@/components/ui/status-badge";
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
  if (health?.status === "running") return "检查中";
  if (health?.status === "passed") return `通过 · ${formatAgentManagerTime(health.at)}`;
  if (health?.status === "failed") return `失败 · ${formatAgentManagerTime(health.at)}`;
  if (agent.status === "online") return "可检查";
  return "不可检查";
}

export function agentManagerHealthTone(agent: AgentManagementAgent, health?: AgentManagementHealthResult): StatusBadgeTone {
  if (health?.status === "running") return "accent";
  if (health?.status === "passed") return "success";
  if (health?.status === "failed" || agent.status !== "online") return "danger";
  return "neutral";
}
