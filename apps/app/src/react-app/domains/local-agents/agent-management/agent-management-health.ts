import type { StatusBadgeTone } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import type {
  AgentManagementAgent,
  PersonalLocalAgentRunResult,
} from "../../../../app/lib/desktop";

export type AgentManagementHealthResult = {
  status: "idle" | "running" | "passed" | "failed" | "missing" | "needs_auth";
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
  // Upstream parity (AgentCard.tsx color map): online=green, needs_auth=gold,
  // missing=red, offline=orange, unknown=gray. missing is a problem (red);
  // offline/unknown are degraded-but-not-error (orange / gray).
  if (status === "needs_auth") return "warning";
  if (status === "missing") return "danger";
  if (status === "offline") return "orange";
  return "neutral";
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

export function agentManagerHealthLabel(
  _agent: AgentManagementAgent,
  health?: AgentManagementHealthResult,
): string {
  if (health?.status === "running") return t("agent_manager.health_checking");
  if (health?.status === "passed") {
    return t("agent_manager.health_connected", {
      time: formatAgentManagerTime(health.at),
    });
  }
  if (health?.status === "needs_auth") {
    return t("agent_manager.health_needs_login", {
      time: formatAgentManagerTime(health.at),
    });
  }
  if (health?.status === "missing") {
    return t("agent_manager.health_not_installed", {
      time: formatAgentManagerTime(health.at),
    });
  }
  if (health?.status === "failed") {
    return t("agent_manager.health_disconnected", {
      time: formatAgentManagerTime(health.at),
    });
  }
  // Idle: no secondary badge — status already shows online/offline/missing.
  return "";
}

export function agentManagerHealthTone(agent: AgentManagementAgent, health?: AgentManagementHealthResult): StatusBadgeTone {
  if (health?.status === "running") return "accent";
  if (health?.status === "passed") return "success";
  // Upstream parity (AgentCard.tsx color map): needs_auth=gold (warn, one step
  // away), missing=red (problem), failed/offline=orange (degraded, not error).
  if (health?.status === "needs_auth") return "warning";
  if (health?.status === "missing") return "danger";
  if (health?.status === "failed") return "orange";
  return "neutral";
}
