import { t } from "../../../../i18n";
import type { OnMyAgentSessionSnapshot } from "../../../../app/lib/onmyagent-server";
import type { ComposerAttachment } from "../../../../app/types";

export type SessionError = {
  message: string;
  kind?: "model-not-found" | "generic";
  failedModel?: { providerID: string; modelID: string };
  suggestions?: Array<{ providerID: string; modelID: string }>;
};

export function parseSessionError(thrown: unknown): SessionError {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.name === "ProviderModelNotFoundError" && parsed?.data) {
      const { providerID, modelID, suggestions } = parsed.data;
      return {
        message: `Model ${providerID}/${modelID} is not available.`,
        kind: "model-not-found",
        failedModel: { providerID, modelID },
        suggestions: Array.isArray(suggestions) ? suggestions : [],
      };
    }
    const nestedMessage =
      parsed?.data &&
      typeof parsed.data === "object" &&
      "message" in parsed.data
        ? parsed.data.message
        : parsed?.message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return { message: nestedMessage.trim() };
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
  return parseSessionError(
    typeof error === "string" ? error : JSON.stringify(error),
  );
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
