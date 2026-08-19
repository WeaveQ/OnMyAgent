import { t } from "../../../../i18n";
import type { OnMyAgentSessionSnapshot } from "../../../../app/lib/onmyagent-server";
import type { ComposerAttachment } from "../../../../app/types";

export type SessionError = {
  message: string;
  kind?: "model-not-found" | "generic";
  code?: string;
  messageId?: string;
  traceId?: string;
  createdAt?: number;
  failedModel?: { providerID: string; modelID: string };
  suggestions?: Array<{ providerID: string; modelID: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readIdentifier(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function readModel(value: unknown) {
  if (!isRecord(value)) return null;
  const providerID = readString(value, "providerID");
  const modelID = readString(value, "modelID");
  return providerID && modelID ? { providerID, modelID } : null;
}

function readViolationCode(record: Record<string, unknown> | null): string | undefined {
  const direct = readIdentifier(record, "violationCode");
  if (direct) return direct;
  const details = isRecord(record?.details) ? record.details : null;
  return readIdentifier(details, "violationCode");
}

export function expertRuntimeContractUserMessage(violationCode?: string | null): string {
  switch (violationCode) {
    case "prompt_agent_not_allowed":
    case "agent_identity":
      return t("session.error_expert_runtime_agent");
    case "authorized_directory":
    case "session_identity":
    case "workspace_identity":
      return t("session.error_expert_runtime_directory");
    case "skills_mismatch":
      return t("session.error_expert_runtime_skills");
    case "prompt_token_budget":
    case "prompt_body_too_large":
      return t("session.error_expert_runtime_prompt_size");
    case "prompt_body_invalid":
      return t("session.error_expert_runtime_prompt_invalid");
    default:
      return t("session.error_expert_runtime_contract");
  }
}

/** Strip wrapping quotes / JSON noise and map known engine errors to product copy. */
export function humanizeSessionErrorMessage(raw: string): string {
  let text = raw.trim();
  // JSON-stringified messages often land as `"Streaming response failed"`.
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  if (!text) return t("session.send_prompt_failed");

  const lower = text.toLowerCase();
  if (/expert_runtime_contract_violated/.test(lower)) {
    let violationCode: string | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      const parsedRecord = isRecord(parsed) ? parsed : null;
      const data = isRecord(parsedRecord?.data) ? parsedRecord.data : null;
      violationCode =
        readViolationCode(data) ??
        readViolationCode(parsedRecord);
    } catch {
      /* raw string */
    }
    return expertRuntimeContractUserMessage(violationCode);
  }
  if (
    /streaming response failed/.test(lower) ||
    /failed to stream response/.test(lower)
  ) {
    return t("session.error_streaming_failed");
  }
  if (
    /network|fetch failed|failed to fetch|econnreset|enotfound|etimedout|socket hang up/.test(
      lower,
    )
  ) {
    return t("session.error_network");
  }
  if (/timeout|timed out|deadline exceeded/.test(lower)) {
    return t("session.error_timeout");
  }
  if (/rate limit|too many requests|429\b/.test(lower)) {
    return t("session.error_rate_limit");
  }
  // Provider plan / token-plan quota (async stream often surfaces as AI_APICallError).
  // Must be explicit so the UI ends the run instead of hanging on preparing.
  // CJK provider messages matched via unicode escapes (check-i18n-cjk gate).
  if (
    /quota|token-plan|token plan|exhausted|billing|insufficient.?credit|insufficient.?quota|out of credits|\u989d\u5ea6|\u914d\u989d|\u5957\u9910.*\u7528\u5c3d|\u4f59\u989d\u4e0d\u8db3|\u989d\u5ea6\u5df2\u7528|\u7528\u5c3d/.test(
      lower,
    )
  ) {
    return t("session.error_quota_exhausted");
  }
  if (/unauthorized|401\b|invalid api key|authentication/.test(lower)) {
    return t("session.error_auth");
  }
  if (/model.*not (found|available)|ProviderModelNotFoundError/i.test(text)) {
    return t("session.error_model_unavailable");
  }
  return text;
}

/** Extract a displayable error string from an opencode assistant message error blob. */
export function extractAssistantMessageErrorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed || null;
  }
  if (typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : null;
  const nested =
    (typeof data?.message === "string" && data.message.trim()) ||
    (typeof record.message === "string" && record.message.trim()) ||
    (typeof record.detail === "string" && record.detail.trim()) ||
    null;
  if (nested) return nested;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : null;
  } catch {
    return null;
  }
}

export function parseSessionError(thrown: unknown): SessionError {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  try {
    const parsed: unknown = JSON.parse(raw);
    const parsedRecord = isRecord(parsed) ? parsed : null;
    const data = isRecord(parsedRecord?.data) ? parsedRecord.data : null;
    const name = readString(parsedRecord, "name");
    const code = readIdentifier(data, "code") ?? readIdentifier(parsedRecord, "code");
    const messageId =
      readIdentifier(data, "messageId") ??
      readIdentifier(data, "requestId") ??
      readIdentifier(parsedRecord, "messageId") ??
      readIdentifier(parsedRecord, "requestId");
    const traceId =
      readIdentifier(data, "traceId") ?? readIdentifier(parsedRecord, "traceId");
    const details = {
      ...(code ? { code } : {}),
      ...(messageId ? { messageId } : {}),
      ...(traceId ? { traceId } : {}),
    };
    if (code === "expert_runtime_contract_violated") {
      const violationCode =
        readViolationCode(data) ??
        readViolationCode(parsedRecord);
      return {
        message: expertRuntimeContractUserMessage(violationCode),
        ...details,
      };
    }
    if (name === "ProviderModelNotFoundError" && data) {
      const failedModel = readModel(data);
      const suggestionsValue = data.suggestions;
      const suggestions = Array.isArray(suggestionsValue)
        ? suggestionsValue.flatMap((item) => {
            const model = readModel(item);
            return model ? [model] : [];
          })
        : [];
      return {
        message: failedModel
          ? t("session.error_model_unavailable_named", {
              model: `${failedModel.providerID}/${failedModel.modelID}`,
            })
          : t("session.error_model_unavailable"),
        kind: "model-not-found",
        ...details,
        ...(failedModel ? { failedModel } : {}),
        suggestions,
      };
    }
    const nestedMessage =
      readString(data, "message") ?? readString(parsedRecord, "message");
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return {
        message: humanizeSessionErrorMessage(nestedMessage.trim()),
        ...details,
      };
    }
  } catch {}
  if (
    /ProviderModelNotFoundError/i.test(raw) ||
    /model.*not found/i.test(raw)
  ) {
    return {
      message: humanizeSessionErrorMessage(raw),
      kind: "model-not-found",
    };
  }
  return {
    message: humanizeSessionErrorMessage(raw || t("session.send_prompt_failed")),
  };
}

export function readSnapshotSessionError(
  snapshot: OnMyAgentSessionSnapshot | null,
): SessionError | null {
  const message = snapshot?.messages.at(-1);
  if (!message || message.info.role !== "assistant" || !("error" in message.info)) {
    return null;
  }
  const error = message.info.error;
  if (!error) return null;
  // Full envelope so parseSessionError keeps code / messageId / traceId;
  // nested data.message is humanized (incl. quota) inside parseSessionError.
  const parsed = parseSessionError(
    typeof error === "string" ? error : JSON.stringify(error),
  );
  const createdAt = message.info.time.created;
  return Number.isFinite(createdAt) ? { ...parsed, createdAt } : parsed;
}

export function resolveComposerAttachmentSourcePath(file: File): string | undefined {
  type ElectronFilesBridge = {
    files?: { getPathForFile?: (entry: File) => string | null };
  };
  const scope = globalThis as typeof globalThis & {
    __ONMYAGENT_ELECTRON__?: ElectronFilesBridge;
  };
  const getPathForFile = scope.__ONMYAGENT_ELECTRON__?.files?.getPathForFile;
  if (typeof getPathForFile === "function") {
    try {
      return getPathForFile(file)?.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  const legacyPath = (file as File & { path?: string }).path;
  return typeof legacyPath === "string" && legacyPath.trim()
    ? legacyPath.trim()
    : undefined;
}

export function createComposerAttachments(files: File[]): ComposerAttachment[] {
  return files.map((file) => ({
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind: file.type.startsWith("image/") ? "image" : "file",
    file,
    sourcePath: resolveComposerAttachmentSourcePath(file),
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  }));
}

export function revokeAttachmentPreview(attachment: {
  previewUrl?: string | undefined;
}) {
  if (!attachment.previewUrl) return;
  URL.revokeObjectURL(attachment.previewUrl);
}
