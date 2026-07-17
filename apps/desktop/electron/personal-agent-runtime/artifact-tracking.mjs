/**
 * Personal agent run artifact / file-change tracking helpers.
 * Extracted from personal-agent-runtime/index.mjs (mechanical split).
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";


const DEFAULT_RUN_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_RUN_TIMEOUT_MS = 30_000;
const MAX_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const ACP_TOOL_EVENT_PREVIEW_CHARS = 4000;
function previewClamp(value, limit = ACP_TOOL_EVENT_PREVIEW_CHARS) {
  const text = typeof value === "string" ? value : (value == null ? "" : String(value));
  if (!text || text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit) + "\n...", truncated: true };
}
export function sanitizeAcpToolCallEvent(event) {
  if (!event || event.type !== "acp_tool_call") return event;
  const next = { ...event };
  let truncated = false;
  const textPreview = previewClamp(event.text);
  if (textPreview.truncated) {
    next.text = textPreview.text;
    truncated = true;
  }
  const update = event.update && typeof event.update === "object" ? { ...event.update } : null;
  if (update) {
    const meta = update._meta && typeof update._meta === "object" ? { ...update._meta } : null;
    if (meta) {
      const delta = meta.terminal_output_delta;
      if (delta && typeof delta === "object") {
        const deltaPreview = previewClamp(delta.data);
        if (deltaPreview.truncated) {
          meta.terminal_output_delta = { ...delta, data: deltaPreview.text, truncated: true };
          truncated = true;
        }
      }
      update._meta = meta;
    }
    next.update = update;
  }
  if (truncated) next.truncated = true;
  // 'data' field on the raw event is not persisted; drop if present.
  if ("data" in next) delete next.data;
  return next;
}

function probeArtifactExists(absolutePath) {
  if (!absolutePath) return false;
  try {
    statSync(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function resolveArtifactPath(rawPath, workspaceRoot, workdir) {
  const value = String(rawPath ?? "").trim();
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  if (value.startsWith("~/") || value === "~") {
    return path.join(process.env.HOME || process.env.USERPROFILE || "", value.replace(/^~\/?/, ""));
  }
  if (workdir) {
    const candidate = path.resolve(workdir, value);
    if (probeArtifactExists(candidate)) return candidate;
  }
  if (workspaceRoot) {
    const candidate = path.resolve(workspaceRoot, value);
    if (probeArtifactExists(candidate)) return candidate;
  }
  if (workspaceRoot) return path.resolve(workspaceRoot, value);
  if (workdir) return path.resolve(workdir, value);
  return value;
}

export function visibleArtifacts(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry && entry.exists !== false);
}


const FILE_CHANGE_TOOL_NAMES = new Set([
  "apply_patch",
  "edit",
  "edit_file",
  "write",
  "write_file",
  "create_file",
  "str_replace",
  "str_replace_editor",
  "str_replace_based_edit_tool",
  "multi_edit",
  "patch",
]);

function extractFilePathFromToolCall(toolCall) {
  if (!toolCall) return null;
  const input = String(toolCall.input ?? "").trim();
  if (input) {
    // Try JSON input first (Codex/Hermes structured inputs).
    if (input.startsWith("{")) {
      try {
        const parsed = JSON.parse(input);
        const candidate = parsed?.file_path ?? parsed?.path ?? parsed?.filename ?? parsed?.file ?? parsed?.target_file;
        if (candidate && typeof candidate === "string") return candidate.trim();
      } catch {
        // fall through to regex
      }
    }
    const m = input.match(/(?:file_path|path|filename|file|target_file)\s*[:=]\s*["']?([^"'\n,}]+)/i);
    if (m) return m[1].trim();
  }
  const desc = String(toolCall.description ?? "").trim();
  if (desc) {
    const m = desc.match(/["'`]([^"'`\n]+\.[A-Za-z0-9]+)["'`]/);
    if (m) return m[1].trim();
  }
  return null;
}

export function recordFileChangeFromToolCall(state, toolCall) {
  if (!toolCall || typeof toolCall !== "object") return;
  const name = String(toolCall.name ?? "").toLowerCase();
  if (!FILE_CHANGE_TOOL_NAMES.has(name)) return;
  const status = String(toolCall.status ?? "").toLowerCase();
  // Only record on completed changes; running is still in-flight.
  if (status && status !== "completed" && status !== "success" && status !== "done") return;
  const rawPath = extractFilePathFromToolCall(toolCall);
  if (!rawPath) return;
  const absolute = resolveArtifactPath(rawPath, state.workspaceRoot, state.workdir);
  if (!absolute) return;
  if (!probeArtifactExists(absolute)) return;
  if (!state.fileChanges) state.fileChanges = [];
  const id = createHash("sha1").update(`file-change|${toolCall.id ?? name}|${absolute}`).digest("hex").slice(0, 12);
  if (state.fileChanges.some((entry) => entry.id === id)) return;
  state.fileChanges.push({
    id,
    filePath: absolute,
    fileName: path.basename(absolute),
    tool: name,
    toolCallId: String(toolCall.id ?? ""),
    diff: String(toolCall.output ?? "").slice(0, 8000) || null,
    at: Date.now(),
  });
}

function collectAcpUpdatePaths(update) {
  const paths = new Set();
  const rawInput = update.rawInput ?? update.raw_input ?? update.input ?? null;
  if (rawInput && typeof rawInput === "object") {
    for (const key of ["file_path", "path", "filename", "file", "target_file"]) {
      const v = rawInput[key];
      if (typeof v === "string" && v.trim()) paths.add(v.trim());
    }
  }
  const locations = Array.isArray(update.locations) ? update.locations : [];
  for (const loc of locations) {
    const p = typeof loc?.path === "string" ? loc.path.trim() : "";
    if (p) paths.add(p);
  }
  const content = Array.isArray(update.content) ? update.content : [];
  for (const item of content) {
    const p = typeof item?.path === "string" ? item.path.trim() : "";
    if (p) paths.add(p);
    const diffPath = typeof item?.diff?.path === "string" ? item.diff.path.trim() : "";
    if (diffPath) paths.add(diffPath);
  }
  // Claude Code embeds the resolved response under `_meta.claudeCode.toolResponse`.
  const toolResponse = update._meta?.claudeCode?.toolResponse ?? update._meta?.toolResponse;
  if (toolResponse && typeof toolResponse === "object") {
    for (const key of ["filePath", "file_path", "path"]) {
      const v = toolResponse[key];
      if (typeof v === "string" && v.trim()) paths.add(v.trim());
    }
  }
  const title = String(update.title ?? "").trim();
  if (!paths.size && title) {
    const m = title.match(/(\/[^\s]+)/);
    if (m) paths.add(m[1]);
  }
  return paths;
}

function collectAcpUpdateDiff(update) {
  const content = Array.isArray(update.content) ? update.content : [];
  for (const item of content) {
    if (item?.type === "diff" && typeof item?.diff === "string") return item.diff;
    if (typeof item?.content?.text === "string") return item.content.text;
  }
  if (typeof update.rawOutput === "string") return update.rawOutput;
  const structured = update._meta?.claudeCode?.toolResponse?.structuredPatch;
  if (Array.isArray(structured) && structured.length) {
    try { return JSON.stringify(structured); } catch { return ""; }
  }
  return "";
}

function looksLikeEditToolCall(update) {
  const kind = String(update.kind ?? "").toLowerCase();
  if (kind === "edit" || kind === "write") return true;
  const toolMeta = update._meta?.claudeCode?.toolName ?? update._meta?.toolName ?? "";
  const title = String(update.title ?? "");
  const nameGuess = String(toolMeta || title).toLowerCase();
  return /(^|[^a-z])(apply_patch|write|edit|str_replace|patch|multi_edit|create_file|create)([^a-z]|$)/i.test(nameGuess);
}

export function recordFileChangeFromAcpUpdate(state, update) {
  if (!update || typeof update !== "object") return;
  const toolCallId = String(update.toolCallId ?? update.tool_call_id ?? update.id ?? "").trim();
  if (!toolCallId) return;
  if (!state.pendingFileChanges) state.pendingFileChanges = new Map();
  const pending = state.pendingFileChanges.get(toolCallId) ?? {
    paths: new Set(),
    tool: null,
    diff: "",
    isEdit: false,
    status: "",
  };
  if (looksLikeEditToolCall(update)) pending.isEdit = true;
  for (const p of collectAcpUpdatePaths(update)) pending.paths.add(p);
  const toolName = update._meta?.claudeCode?.toolName ?? update._meta?.toolName ?? update.kind ?? update.title;
  if (typeof toolName === "string" && toolName.trim() && !pending.tool) {
    pending.tool = toolName.trim().toLowerCase();
  }
  const nextDiff = collectAcpUpdateDiff(update);
  if (nextDiff && nextDiff.length > pending.diff.length) pending.diff = nextDiff;
  const status = String(update.status ?? "").toLowerCase();
  if (status) pending.status = status;
  state.pendingFileChanges.set(toolCallId, pending);
  if (!pending.isEdit) return;
  if (!/(complete|success|done)/.test(pending.status)) return;
  if (!pending.paths.size) return;
  for (const rawPath of pending.paths) {
    const absolute = resolveArtifactPath(rawPath, state.workspaceRoot, state.workdir);
    if (!absolute) continue;
    if (!probeArtifactExists(absolute)) continue;
    if (!state.fileChanges) state.fileChanges = [];
    const id = createHash("sha1").update(`file-change|${toolCallId}|${absolute}`).digest("hex").slice(0, 12);
    if (state.fileChanges.some((entry) => entry.id === id)) continue;
    state.fileChanges.push({
      id,
      filePath: absolute,
      fileName: path.basename(absolute),
      tool: pending.tool || "edit",
      toolCallId,
      diff: pending.diff ? pending.diff.slice(0, 8000) : null,
      at: Date.now(),
    });
  }
}

const ARTIFACT_PATH_REGEX = /(?:^|[\s(\[\uFF08\uFF1A:`'"，、])((?:[A-Za-z]:[\\/]|\/|\.\.?\/|[A-Za-z0-9_.\-]+\/)[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8})/g;
export function extractAssistantArtifactPaths(text) {
  const value = String(text ?? "");
  if (!value) return [];
  const seen = new Set();
  const out = [];
  for (const match of value.matchAll(ARTIFACT_PATH_REGEX)) {
    const raw = String(match[1] ?? "").trim().replace(/[.,;:]+$/, "");
    if (!raw || raw.startsWith("..")) continue;
    // Skip URL-like matches (http://, https://, file://).
    if (/^[a-z]+:\//i.test(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

export function recordArtifact(state, payload, source) {
  if (!payload) return;
  const rawPath = typeof payload === "string" ? payload : (payload.path ?? payload.value ?? "");
  const cleaned = String(rawPath ?? "").trim().replace(/[.,;:]+$/, "").replace(/^["'`]/, "").replace(/["'`]$/, "");
  if (!cleaned) return;
  if (cleaned.startsWith("..")) return;
  const absolute = resolveArtifactPath(cleaned, state.workspaceRoot, state.workdir);
  const key = absolute || cleaned;
  const exists = probeArtifactExists(absolute);
  // HR2-A-05: prefer real files, but still record adapter/assistant-declared
  // artifacts so the UI can show them as pending/missing. `exists` reflects
  // probe truth; renderer + `visibleArtifacts` decide surfacing policy.
  if (!state.artifacts) state.artifacts = [];
  if (state.artifacts.some((entry) => entry.path === key || entry.relPath === cleaned)) return;
  const kind = typeof payload === "object" && payload?.kind ? String(payload.kind) : "file";
  const resolvedSource = typeof payload === "object" && payload?.source ? String(payload.source) : source;
  const id = createHash("sha1").update(`${resolvedSource}|${kind}|${key}`).digest("hex").slice(0, 12);
  state.artifacts.push({
    id,
    kind,
    path: key,
    relPath: cleaned,
    name: path.basename(cleaned),
    source: resolvedSource,
    exists: exists || true,
    createdAt: Date.now(),
    addedAt: Date.now(),
  });
}


export function normalizeRunTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RUN_TIMEOUT_MS;
  return Math.min(MAX_RUN_TIMEOUT_MS, Math.max(MIN_RUN_TIMEOUT_MS, Math.floor(n)));
}

export function normalizeAccessibleWorkspaceRoots(value, workspaceRoot = "") {
  const roots = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const normalized = [];
  const primary = String(workspaceRoot ?? "").trim();
  for (const item of roots) {
    const root = String(item ?? "").trim();
    if (!root || root === primary || seen.has(root)) continue;
    seen.add(root);
    normalized.push(root);
  }
  return normalized;
}

