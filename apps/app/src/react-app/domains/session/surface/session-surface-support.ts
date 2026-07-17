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
          ? `Model ${failedModel.providerID}/${failedModel.modelID} is not available.`
          : t("session.send_prompt_failed"),
        kind: "model-not-found",
        ...details,
        ...(failedModel ? { failedModel } : {}),
        suggestions,
      };
    }
    const nestedMessage =
      readString(data, "message") ?? readString(parsedRecord, "message");
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return { message: nestedMessage.trim(), ...details };
    }
  } catch {}
  if (
    /ProviderModelNotFoundError/i.test(raw) ||
    /model.*not found/i.test(raw)
  ) {
    return { message: raw, kind: "model-not-found" };
  }
  return { message: raw || t("session.send_prompt_failed") };
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
  const parsed = parseSessionError(
    typeof error === "string" ? error : JSON.stringify(error),
  );
  const createdAt = message.info.time.created;
  return Number.isFinite(createdAt) ? { ...parsed, createdAt } : parsed;
}

export function createComposerAttachments(files: File[]): ComposerAttachment[] {
  return files.map((file) => ({
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind: file.type.startsWith("image/") ? "image" : "file",
    file,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  }));
}

export function revokeAttachmentPreview(attachment: {
  previewUrl?: string | undefined;
}) {
  if (!attachment.previewUrl) return;
  URL.revokeObjectURL(attachment.previewUrl);
}
