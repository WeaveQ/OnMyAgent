export type ExpertChatPromptPart =
  | { type: "text"; text: string }
  | { type: "file"; mime: string; filename: string; url: string };

function attachmentKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.type}\u0000${file.lastModified}`;
}

export function mergeExpertChatAttachments(
  current: readonly File[],
  incoming: readonly File[],
): File[] {
  const merged = new Map(current.map((file) => [attachmentKey(file), file]));
  for (const file of incoming) merged.set(attachmentKey(file), file);
  return Array.from(merged.values());
}

async function readFileAsDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:${file.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export async function buildExpertChatPromptParts(
  message: string,
  attachments: readonly File[],
): Promise<ExpertChatPromptPart[]> {
  const parts: ExpertChatPromptPart[] = [];
  if (message.trim()) parts.push({ type: "text", text: message.trim() });
  for (const file of attachments) {
    parts.push({
      type: "file",
      mime: file.type || "application/octet-stream",
      filename: file.name,
      url: await readFileAsDataUrl(file),
    });
  }
  return parts;
}
