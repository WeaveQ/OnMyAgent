/**
 * Pure attachment intake for the session composer.
 * Host owns i18n notices + store wiring; this unit compresses, size-gates,
 * and converts Appshot native payloads into File objects.
 */
import {
  compressImageFile,
  MAX_ATTACHMENT_BYTES,
} from "./composer-helpers";
import {
  isSafeAttachmentDisplayName,
  sanitizeAppshotFileName,
} from "./appshot";

export type ProcessAttachmentFilesResult = {
  accepted: File[];
  /** Display names for files that exceeded the byte limit after processing. */
  oversizeNames: string[];
};

export async function processAttachmentFiles(
  inputFiles: File[],
  options?: {
    maxBytes?: number;
    compressImage?: (file: File) => Promise<File>;
  },
): Promise<ProcessAttachmentFilesResult> {
  if (!inputFiles.length) return { accepted: [], oversizeNames: [] };

  const maxBytes = options?.maxBytes ?? MAX_ATTACHMENT_BYTES;
  const compress = options?.compressImage ?? compressImageFile;
  const accepted: File[] = [];
  const oversizeNames: string[] = [];

  for (const original of inputFiles) {
    const processed = original.type.startsWith("image/")
      ? await compress(original)
      : original;
    if (processed.size > maxBytes) {
      oversizeNames.push(processed.name || original.name);
      continue;
    }
    accepted.push(processed);
  }

  return { accepted, oversizeNames };
}

export type AppshotPayload = {
  name: string;
  mimeType: string;
  /** Base64-encoded image bytes from the native helper. */
  data: string;
};

export function parseAppshotPayload(payload: unknown): AppshotPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("name" in payload) || typeof payload.name !== "string") return null;
  if (!("mimeType" in payload) || typeof payload.mimeType !== "string") return null;
  if (!("data" in payload) || typeof payload.data !== "string") return null;
  return {
    name: payload.name,
    mimeType: payload.mimeType,
    data: payload.data,
  };
}

export function fileFromAppshotPayload(payload: AppshotPayload): File {
  const safeName = sanitizeAppshotFileName(payload.name);
  const binary = atob(payload.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], safeName, {
    type: payload.mimeType,
    lastModified: Date.now(),
  });
}

/** Short, safe name for compact success notices (null → omit description). */
export function formatAttachmentSuccessDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (!isSafeAttachmentDisplayName(trimmed)) return null;
  return trimmed.length > 40 ? `${trimmed.slice(0, 37)}…` : trimmed;
}

export function formatOversizeAttachmentName(
  name: string,
  fallback: string,
): string {
  return isSafeAttachmentDisplayName(name) ? name : fallback;
}
