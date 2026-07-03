import { t } from "@/i18n";
import type { PersonalLocalAgent, PersonalLocalAgentRunResult } from "../../../app/lib/desktop";

const PROVIDER_LABELS: Record<PersonalLocalAgent["provider"], string> = {
  opencode: "OpenCode",
  codex: "Codex",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  custom: "Custom",
};

export function shortTime(value: number | null | undefined) {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function elapsedSeconds(startedAt: number | null | undefined, finishedAt: number | null | undefined) {
  if (!startedAt) return "--";
  const end = finishedAt ?? Date.now();
  return t("local_agent.elapsed_seconds", { count: Math.max(0, Math.round((end - startedAt) / 1000)) });
}

export function runStatusLabel(status: PersonalLocalAgentRunResult["status"]) {
  return t(`local_agent.status_${status}`);
}

export function runHumanSummary(run: PersonalLocalAgentRunResult) {
  const status = runStatusLabel(run.status);
  const provider = run.agentProvider ? PROVIDER_LABELS[run.agentProvider] : t("nav.local_agent");
  if (run.status === "running" && run.pendingApprovals?.length) return t("local_agent.run_summary_waiting_approval", { provider, count: run.pendingApprovals.length });
  if (run.status === "running") return t("local_agent.run_summary_running", { provider, elapsed: elapsedSeconds(run.startedAt, null) });
  if (run.status === "completed") return t("local_agent.run_summary_completed", { provider, elapsed: elapsedSeconds(run.startedAt, run.finishedAt) });
  if (run.status === "failed") return t("local_agent.run_summary_failed", { provider, elapsed: elapsedSeconds(run.startedAt, run.finishedAt) });
  if (run.status === "cancelled") return t("local_agent.run_summary_cancelled", { provider, elapsed: elapsedSeconds(run.startedAt, run.finishedAt) });
  return t("local_agent.run_summary_status", { provider, status });
}
