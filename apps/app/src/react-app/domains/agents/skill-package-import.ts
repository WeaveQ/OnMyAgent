import { t } from "@/i18n";

function yamlScalar(markdown: string, key: string): string {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const line = frontmatter
    .split(/\r?\n/)
    .find((item) => item.trimStart().startsWith(`${key}:`));
  if (!line) return "";
  return line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function findZipEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function inflateRawZipEntry(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const stream = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  return new TextDecoder().decode(inflated);
}

async function decodeZipEntry(bytes: Uint8Array, method: number): Promise<string> {
  if (method === 0) return new TextDecoder().decode(bytes);
  if (method === 8) return inflateRawZipEntry(bytes);
  throw new Error(t("skills_marketplace.import_zip_method_unsupported"));
}

async function readSkillMarkdownFromZip(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findZipEndOfCentralDirectory(bytes);
  if (endOffset < 0) throw new Error(t("skills_marketplace.import_zip_invalid"));

  const entryCount = view.getUint16(endOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(t("skills_marketplace.import_zip_invalid"));
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const entryName = new TextDecoder().decode(bytes.slice(fileNameStart, fileNameEnd));
    if (entryName.toLowerCase() === "skill.md" || entryName.toLowerCase().endsWith("/skill.md")) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error(t("skills_marketplace.import_zip_invalid"));
      }
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      return decodeZipEntry(bytes.slice(dataStart, dataEnd), method);
    }
    offset = fileNameEnd + extraLength + commentLength;
  }
  throw new Error(t("skills_marketplace.import_no_skill_md"));
}

export async function readSkillMarkdown(file: File): Promise<{
  name: string;
  description?: string;
  content: string;
}> {
  const content = file.name.toLowerCase().endsWith(".zip")
    ? await readSkillMarkdownFromZip(file)
    : await file.text();
  const name = yamlScalar(content, "name");
  if (!name) throw new Error(t("skills_marketplace.import_missing_name"));
  return {
    name,
    description: yamlScalar(content, "description") || undefined,
    content,
  };
}

export function findSkillMarkdownFile(files: File[]): File | null {
  const candidates = files.filter((file) => {
    const normalizedName = file.name.toLowerCase();
    return normalizedName.endsWith(".md") || normalizedName.endsWith(".zip");
  });
  return candidates.find((file) => file.name.toLowerCase() === "skill.md") ??
    candidates.find((file) => file.webkitRelativePath.toLowerCase().endsWith("/skill.md")) ??
    candidates[0] ??
    null;
}
