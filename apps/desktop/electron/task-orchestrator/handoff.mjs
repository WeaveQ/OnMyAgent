/**
 * V2 prompt/data helpers kept separate from the durable runner.  Execution
 * control is provided by task-scoped MCP tools; these helpers never encode a
 * fixed role graph or ask a provider to parse shell instructions.
 */
const MAX_ARTIFACT_PROMPT_CHARS = 120_000;

/** @typedef {{id?: string, revision?: number, idea?: string, workspaceRoot?: string, permissionMode?: string, contractFinalization?: string, contract?: unknown}} TaskLike */
/** @typedef {{task?: TaskLike, text?: string, attempt?: number, prompt?: string, artifacts?: Array<Record<string, unknown>>}} PromptInput */

function truncate(value) {
  const text = String(value ?? "");
  return text.length <= MAX_ARTIFACT_PROMPT_CHARS
    ? text
    : `${text.slice(0, MAX_ARTIFACT_PROMPT_CHARS)}\n...[truncated by task orchestrator]`;
}

function taskDocument(task) {
  return {
    taskId: task.id,
    revision: task.revision,
    idea: task.idea,
    workspaceRoot: task.workspaceRoot,
    permissionMode: task.permissionMode,
    contractFinalization: task.contractFinalization,
    contract: task.contract,
  };
}

function artifactDocument(artifact) {
  return {
    id: artifact.id,
    kind: artifact.kind,
    summary: artifact.summary,
    content: truncate(artifact.content),
    evidence: artifact.evidence,
  };
}

/** @param {PromptInput} input */
export function buildAlignmentPrompt({ task, text = "" } = {}) {
  return [
    "Use the structured propose_contract host tool when a candidate contract is ready.",
    "Ask concise clarification questions before proposing; do not infer a contract from unvalidated prose.",
    `<task-json>\n${JSON.stringify(taskDocument(task), null, 2)}\n</task-json>`,
    text ? `Human alignment message:\n${text}` : "",
  ].filter(Boolean).join("\n\n").slice(0, MAX_ARTIFACT_PROMPT_CHARS);
}

/** @param {PromptInput} input */
export function buildPrimaryPrompt({ task, attempt, artifacts = [] } = {}) {
  return [
    "Execute the frozen task contract as the primary local agent.",
    "Use only tools from the MCP server `onmyagent-task-control`; never use provider-native collaboration or subagent tools with similar names.",
    "For Codex, use the fully qualified `mcp.onmyagent-task-control.*` delegation tools and only configured worker profiles; depth is one.",
    `<task-json>\n${JSON.stringify(taskDocument(task), null, 2)}\n</task-json>`,
    `Attempt: ${String(attempt ?? 1)}`,
    artifacts.length ? `<artifacts-json>\n${JSON.stringify(artifacts.map(artifactDocument), null, 2)}\n</artifacts-json>` : "",
  ].filter(Boolean).join("\n\n").slice(0, MAX_ARTIFACT_PROMPT_CHARS);
}

/** @param {PromptInput} input */
export function buildWorkerPrompt({ task, prompt, artifacts = [] } = {}) {
  return [
    "Execute this depth-one worker assignment in the configured workspace.",
    "Delegation controls are unavailable to workers; do not attempt recursive delegation.",
    `<task-json>\n${JSON.stringify(taskDocument(task), null, 2)}\n</task-json>`,
    `Assignment:\n${String(prompt ?? "")}`,
    artifacts.length ? `<artifacts-json>\n${JSON.stringify(artifacts.map(artifactDocument), null, 2)}\n</artifacts-json>` : "",
  ].filter(Boolean).join("\n\n").slice(0, MAX_ARTIFACT_PROMPT_CHARS);
}

/** Structured host outputs are validated by the caller, never guessed here. */
export function parseStructuredProposal(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function summarizeOutput(output, fallback) {
  const text = String(output ?? "").trim();
  if (!text) return fallback;
  const firstParagraph = text.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return firstParagraph.slice(0, 4_000) || fallback;
}
