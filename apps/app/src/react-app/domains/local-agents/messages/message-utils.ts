import { t } from "@/i18n";
import { classifyOpenTarget, type OpenTarget } from "../../../capabilities/artifacts/open-target";
import type { PersonalLocalAgent, PersonalLocalAgentConversationMessage, PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";

export function isRunFinal(status: PersonalLocalAgentRunResult["status"] | undefined) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "missing";
}

function structuredArtifactTargets(run: PersonalLocalAgentRunResult | undefined | null): OpenTarget[] {
  if (!run?.artifacts?.length) return [];
  const map = new Map<string, OpenTarget>();
  for (const entry of run.artifacts) {
    if (entry.exists === false) continue;
    const value = entry.path || entry.relPath;
    if (!value) continue;
    const id = `file:${value.toLowerCase()}`;
    if (map.has(id)) continue;
    map.set(id, {
      id,
      kind: "file",
      value,
      name: entry.name || value.split(/[\\/]/).filter(Boolean).pop() || value,
      preview: classifyOpenTarget(value, "file"),
      confidence: 0.96,
      reason: entry.source === "adapter" ? t("local_agent.artifact_source_adapter") : t("local_agent.artifact_source_reply"),
      exists: entry.exists,
    });
  }
  return [...map.values()];
}

function extractArtifactTargets(output: string, workspaceRoot: string): OpenTarget[] {
  const map = new Map<string, OpenTarget>();
  const pattern = /(?:\u4EA7\u7269\u6587\u4EF6\uFF1A|^|[\s"'`([{])((?:\.{1,2}[/\\]|~[/\\]|[/\\])?[\w.\-]+(?:[/\\][\w.\-]+)*\.(?:md|markdown|mdx|txt|log|json|csv|tsv|xlsx|html|pdf|png|jpg|jpeg|webp|svg))/gim;
  for (const match of output.matchAll(pattern)) {
    const raw = match[1]?.trim().replace(/[.,;:]+$/, "");
    if (!raw) continue;
    const cleaned = raw.replace(/^\.\//, "");
    if (!cleaned || cleaned.startsWith("..")) continue;
    // Keep the original raw string so the open handler can decide between
    // workspace-relative artifacts and absolute filesystem paths.
    const value = cleaned;
    const target: OpenTarget = {
      id: `file:${value.toLowerCase()}`,
      kind: "file",
      value,
      name: value.split(/[\\/]/).filter(Boolean).pop() ?? value,
      preview: classifyOpenTarget(value, "file"),
      confidence: 0.92,
      reason: t("local_agent.artifact_source_file"),
      exists: true,
    };
    map.set(target.id, target);
  }
  void workspaceRoot;
  return [...map.values()];
}

const URL_TARGET_PATTERN = /(?:https?|wss?):\/\/[^\s)\]}>"'`]+/gi;

function extractUrlTargets(output: string): OpenTarget[] {
  if (!output) return [];
  const map = new Map<string, OpenTarget>();
  for (const match of output.matchAll(URL_TARGET_PATTERN)) {
    const raw = match[0]?.replace(/[.,;:`\\]+$/, "");
    if (!raw) continue;
    let clean = raw;
    try {
      const parsed = new URL(raw.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:"));
      if (parsed.pathname === "/" && !parsed.search && !parsed.hash) clean = parsed.origin;
    } catch {
      // Keep raw value if it cannot be parsed; the regex already validated shape.
    }
    const id = `url:${clean}`;
    if (map.has(id)) continue;
    const name = (() => {
      try {
        return new URL(clean).host || clean;
      } catch {
        return clean;
      }
    })();
    map.set(id, {
      id,
      kind: "url",
      value: clean,
      name,
      preview: "browser",
      confidence: 0.9,
      reason: t("local_agent.artifact_source_url"),
    });
  }
  return [...map.values()];
}

export function collectRunOpenTargets(
  run: PersonalLocalAgentRunResult | undefined | null,
  workspaceRoot: string,
  fallbackText = "",
): OpenTarget[] {
  const sourceText = run?.output ?? fallbackText ?? "";
  const fileFromStructured = structuredArtifactTargets(run);
  const fileTargets = fileFromStructured.length
    ? fileFromStructured
    : extractArtifactTargets(sourceText, workspaceRoot);
  const urlTargets = extractUrlTargets(sourceText);
  const seen = new Set<string>();
  const out: OpenTarget[] = [];
  for (const target of [...urlTargets, ...fileTargets]) {
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    out.push(target);
  }
  return out;
}


export async function writeTextToClipboard(value: string | null | undefined): Promise<boolean> {
  const text = (value ?? "").toString();
  if (!text || typeof window === "undefined") return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function resolveDesktopPath(value: string | null | undefined, workspaceRoot: string): string | null {
  const target = (value ?? "").trim();
  if (!target) return null;
  if (target.startsWith("/") || /^[a-z]:\\/i.test(target) || target.startsWith("\\\\")) return target;
  if (!workspaceRoot) return target;
  const cleaned = target.replace(/^\.\/+/, "");
  const root = workspaceRoot.replace(/\/+$/, "");
  return `${root}/${cleaned}`;
}


export function classifiedRunFailureMessage(run: PersonalLocalAgentRunResult) {
  const code = run.errorInfo?.code ?? "";
  const message = run.errorInfo?.message || run.error || "";
  if (code === "codex_acp_model_format") return t("local_agent.failure_codex_model_format", { message });
  if (code === "codex_acp_mode_failed") return t("local_agent.failure_codex_mode", { message });
  if (code === "acp_bridge_interrupted" || code === "acp_bridge_interrupted_after_retry") return t("local_agent.failure_acp_interrupted", { message });
  if (code === "acp_tool_failed") return t("local_agent.failure_acp_tool", { message });
  if (code === "sandbox_or_network_refusal") return t("local_agent.failure_sandbox_network", { message });
  if (code === "empty_output") return t("local_agent.failure_empty_output", { message });
  if (code === "acp_incomplete_output") return t("local_agent.failure_acp_incomplete", { message });
  // Legacy raw English still seen in older runs / misclassified codes.
  if (/without assistant text|completed without assistant|no assistant text/i.test(message)) {
    return t("local_agent.failure_empty_output", { message });
  }
  if (message) return message;
  return t("local_agent.failed");
}

/** True when the run timeline already surfaces the failure (avoid footer duplicate). */
export function runTimelineAlreadyShowsFailure(run: PersonalLocalAgentRunResult | null | undefined) {
  const messages = run?.conversationMessages ?? [];
  return messages.some(
    (message) =>
      message.type === "error"
      || (message.type === "tips" && message.category === "error"),
  );
}


export function runDebugBundle(run: PersonalLocalAgentRunResult, ctx?: {
  agent?: PersonalLocalAgent | null;
  selectedModel?: string;
}) {
  const agent = ctx?.agent ?? null;
  const capability = agent?.capability ?? null;
  const stderrTail = run.events
    .filter((event) => event.type === "log" && /^stderr>/.test(event.text))
    .slice(-20)
    .map((event) => `${new Date(event.at).toISOString()} ${event.text}`);
  const artifactsBlock = run.artifacts?.length
    ? ["Artifacts:", ...run.artifacts.map((entry) => `- ${entry.path}${entry.exists === false ? " (missing)" : ""} [${entry.source}]`)]
    : [];
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  return [
    `Run ID: ${run.runId}`,
    `Provider: ${run.agentProvider ?? "unknown"}`,
    `Status: ${run.status}`,
    `Connection: ${run.connectionMode ?? "--"}`,
    `Approval mode: ${run.approvalMode ?? "--"}`,
    `Provider session ID: ${run.providerSessionId ?? "--"}`,
    `Resume key: ${run.resumeKey ?? "--"}`,
    `Workdir: ${run.workdir ?? "--"}`,
    `PID: ${run.pid ?? "--"}`,
    `Log path: ${run.logPath ?? "--"}`,
    `Started at: ${run.startedAt ? new Date(run.startedAt).toISOString() : "--"}`,
    `Finished at: ${run.finishedAt ? new Date(run.finishedAt).toISOString() : "--"}`,
    agent ? `Selected model / target: ${ctx?.selectedModel || agent.model || agent.defaultModel || t("local_agent.local_default")}` : null,
    agent ? `Agent version: ${agent.version || "--"}` : null,
    agent ? `Executable: ${agent.executablePath || "--"}` : null,
    capability ? `Capability: streaming=${capability.supportsStreaming} resume=${capability.supportsResume} approve=${capability.supportsPermissionAutoApprove} target=${capability.targetKind}` : null,
    capability?.warning ? `Capability warning: ${capability.warning}` : null,
    userAgent ? `Runtime UA: ${userAgent}` : null,
    run.errorInfo ? `Error: ${run.errorInfo.code} ${run.errorInfo.message}` : null,
    run.debugSummary ? `Debug:\n${run.debugSummary}` : null,
    stderrTail.length ? ["Stderr tail:", ...stderrTail].join("\n") : null,
    artifactsBlock.length ? artifactsBlock.join("\n") : null,
    "Command:",
    run.command || "--",
    "Events:",
    ...run.events.map((event) => `${new Date(event.at).toISOString()} ${event.type}> ${event.text}`),
  ].filter(Boolean).join("\n");
}
