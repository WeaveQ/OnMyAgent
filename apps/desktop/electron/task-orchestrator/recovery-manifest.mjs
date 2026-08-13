import { redactSensitiveText, safeText } from "./durable-redaction.mjs";

/** Marker kept in the durable prompt so duplicate recovery clicks are no-ops. */
export const RECOVERY_PROMPT_MARKER = "[task-center-recovery]";

const MAX_MANIFEST_CHARS = 12_000;
const MAX_ATTEMPT_PROMPT = 1_200;
const MAX_OUTPUT_EXCERPT = 3_200;
const MAX_ARTIFACT_SUMMARY = 480;
const MAX_EVIDENCE_LABEL = 180;

function compact(value, limit) {
  return redactSensitiveText(safeText(value).replaceAll("\u0000", ""), limit).trim();
}

function profileForAttempt(run, attempt) {
  if (!attempt) return null;
  if (attempt.kind === "primary") return run.definition.primary;
  return run.definition.allowedWorkers.find((profile) => profile.id === attempt.profileId) ?? null;
}

function attemptLine(run, attempt) {
  const profile = profileForAttempt(run, attempt);
  return [
    `- ${compact(attempt.id, 120)} · ${compact(attempt.kind, 24)} · status=${compact(attempt.status, 32)} · profile=${compact(profile?.label ?? attempt.profileId, 120)}`,
    `  prompt: ${compact(attempt.prompt, MAX_ATTEMPT_PROMPT) || "(none)"}`,
  ].join("\n");
}

function artifactLine(artifact) {
  const evidence = (Array.isArray(artifact?.evidence) ? artifact.evidence : [])
    .slice(0, 24)
    .map((item) => `${compact(item?.label, MAX_EVIDENCE_LABEL) || "evidence"} [${compact(item?.status, 24) || "info"}]`)
    .join(", ");
  return [
    `- ${compact(artifact?.id, 120) || "artifact"} · attempt=${compact(artifact?.attemptId, 120) || "unknown"} · kind=${compact(artifact?.kind, 24) || "unknown"}`,
    `  summary: ${compact(artifact?.summary, MAX_ARTIFACT_SUMMARY) || "(none)"}`,
    `  evidence labels: ${evidence || "(none)"}`,
  ].join("\n");
}

/**
 * Build a bounded, durable-redacted context packet for a fresh primary.
 * Artifact ids alone are insufficient after a restart, so summaries, evidence
 * labels, and a small prior-primary output excerpt are included as context.
 */
export function buildRecoveryManifest({ run, currentAttempt, artifacts = [] }) {
  const attempts = [...(run?.primaryAttempts ?? []), ...(run?.workerAttempts ?? [])];
  const primary = [...(run?.primaryAttempts ?? [])].at(-1) ?? null;
  const primaryArtifacts = (Array.isArray(artifacts) ? artifacts : []).filter((artifact) => artifact?.attemptId === primary?.id);
  const outputExcerpt = primaryArtifacts
    .map((artifact) => compact(artifact?.content, MAX_OUTPUT_EXCERPT))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_OUTPUT_EXCERPT);
  const manifest = [
    RECOVERY_PROMPT_MARKER,
    "Safe continuation context (durable, redacted; context only):",
    `Run status at interruption: ${compact(run?.status, 32) || "blocked"}`,
    `Current interrupted attempt: ${compact(currentAttempt?.id, 120) || "unknown"} · kind=${compact(currentAttempt?.kind, 24) || "unknown"} · status=${compact(currentAttempt?.status, 32) || "blocked"}`,
    `Interrupted profile: ${compact(profileForAttempt(run, currentAttempt)?.label ?? currentAttempt?.profileId, 120) || "unknown"}`,
    `Interrupted prompt summary: ${compact(currentAttempt?.prompt, MAX_ATTEMPT_PROMPT) || "(none)"}`,
    "Prior attempts (immutable; do not revive or replay):",
    attempts.length ? attempts.map((attempt) => attemptLine(run, attempt)).join("\n") : "- (none)",
    "Prior durable artifacts (read-only context):",
    artifacts.length ? artifacts.slice(-60).map(artifactLine).join("\n") : "- (none)",
    `Prior primary output excerpt: ${outputExcerpt || "(no primary output artifact was saved)"}`,
    "Continuation rules:",
    "- Start a fresh primary Personal conversation for this continuation; never resume, revive, or replay an old provider process or conversation.",
    "- Inspect the actual bound workspace before acting. Treat prior prompts, outputs, and evidence as context; do not assume an interrupted command needs replay.",
    "- Preserve the frozen contract, selected models/providers, permission mode, workspace containment, and existing artifacts.",
    "- Decide from the current workspace and contract whether a fresh depth-one worker is useful; any worker must be newly spawned through the task-scoped MCP tools.",
  ].join("\n");
  return redactSensitiveText(manifest, MAX_MANIFEST_CHARS);
}

export function isRecoveryAttempt(attempt) {
  return Boolean(attempt && typeof attempt.prompt === "string" && attempt.prompt.includes(RECOVERY_PROMPT_MARKER));
}
