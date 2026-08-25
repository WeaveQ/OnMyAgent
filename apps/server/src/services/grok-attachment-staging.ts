import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "../core/errors.js";
import { resolveRuntimeDataRoot } from "./runtime-data-root.js";

const MAX_ATTACHMENTS = 8;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".ts", ".tsx", ".js", ".mjs", ".py",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf",
]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".ts", ".tsx", ".js", ".mjs", ".py",
]);

export type CanonicalPromptBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; name: string; uri: string; mime?: string }
  | { type: "staged_file"; name: string; path: string; mime?: string; content?: string }
  | { type: "image"; name: string; path: string; mime?: string };

export function resolveGrokAttachmentStagingRoot(dataRoot?: string): string {
  return join(resolveRuntimeDataRoot(dataRoot), "grok-staging");
}

export async function stageWorkspaceAttachments(input: {
  workspaceRoot: string;
  sessionId: string;
  files: ReadonlyArray<{ url: string; filename?: string; mime?: string }>;
  dataRoot?: string;
}): Promise<CanonicalPromptBlock[]> {
  if (input.files.length > MAX_ATTACHMENTS) {
    throw new ApiError(400, "grok_attachment_limit", "Too many Grok attachments in one turn");
  }
  const workspaceRoot = await realpathOrReject(
    resolve(input.workspaceRoot),
    "grok_attachment_invalid",
    "Grok attachment workspace is invalid",
  );
  const stagingRoot = await prepareSessionStagingRoot(input.sessionId, input.dataRoot);
  const staged: CanonicalPromptBlock[] = [];
  for (const file of input.files) {
    if (isDataUrl(file.url)) {
      staged.push(await stageDataUrlAttachment(file, stagingRoot));
      continue;
    }
    const lexical = resolveWorkspaceFile(workspaceRoot, file.url);
    const realSource = await realpathIfExists(lexical);
    if (!realSource) {
      assertLexicalInside(workspaceRoot, lexical);
      throw new ApiError(400, "grok_attachment_invalid", "Grok attachments must be regular workspace files");
    }
    const source = assertInside(
      workspaceRoot,
      realSource,
      "grok_attachment_outside_workspace",
      "Grok attachments must stay inside the workspace",
    );
    const stats = await lstat(lexical).catch(() => {
      throw new ApiError(400, "grok_attachment_invalid", "Grok attachments must be regular workspace files");
    });
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new ApiError(400, "grok_attachment_invalid", "Grok attachments must be regular workspace files");
    }
    if (stats.size > MAX_BYTES) {
      throw new ApiError(400, "grok_attachment_too_large", "Grok attachment exceeds the size limit");
    }
    const extension = extname(source).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new ApiError(400, "grok_attachment_type", "Grok attachment type is not allowed");
    }
    const name = sanitizeName(file.filename ?? basename(source));
    const target = join(stagingRoot, `${randomUUID()}-${name}`);
    await copyFile(source, target);
    const stagedPath = assertInside(
      stagingRoot,
      await realpathOrReject(
        target,
        "grok_attachment_invalid",
        "Grok attachment staging escaped the runtime root",
      ),
      "grok_attachment_invalid",
      "Grok attachment staging escaped the runtime root",
    );
    const mime = file.mime?.trim();
    const content = TEXT_EXTENSIONS.has(extension)
      ? await readFile(source, "utf8")
      : undefined;
    staged.push(
      mime?.startsWith("image/")
        ? { type: "image", name, path: stagedPath, mime }
        : {
          type: "staged_file",
          name,
          path: stagedPath,
          ...(mime ? { mime } : {}),
          ...(content !== undefined ? { content } : {}),
        },
    );
  }
  return staged;
}

export async function cleanupGrokStagedAttachments(input: {
  sessionId: string;
  dataRoot?: string;
}): Promise<void> {
  const stagingRoot = resolveGrokAttachmentStagingRoot(input.dataRoot);
  const sessionRoot = join(stagingRoot, sanitizeName(input.sessionId));
  try {
    const realSession = await realpath(sessionRoot);
    const realRoot = await realpath(stagingRoot);
    const relativePath = relative(realRoot, realSession);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return;
    await rm(realSession, { recursive: true, force: true });
  } catch {
    // Missing staging is a successful cleanup.
  }
}

export async function buildGrokPromptFromRuntimeParts(input: {
  text: string;
  parts?: ReadonlyArray<{
    type: string;
    url?: string;
    filename?: string;
    mime?: string;
    path?: string;
    uri?: string;
    text?: string;
  }>;
  workspaceRoot: string;
  sessionId: string;
  dataRoot?: string;
}): Promise<Array<{ type: "text"; text: string }>> {
  const blocks: CanonicalPromptBlock[] = [];
  const pendingStaged: Array<{
    type: "staged_file" | "image";
    name: string;
    path: string;
    mime?: string;
  }> = [];
  if (input.text.trim()) blocks.push({ type: "text", text: input.text });
  const files = (input.parts ?? []).flatMap((part) => {
    if ((part.type === "file" || part.type === "image") && part.url) {
      return [{ url: part.url, filename: part.filename, mime: part.mime }];
    }
    if (part.type === "staged_file" && part.path) {
      pendingStaged.push({
        type: "staged_file",
        name: part.filename ?? "attachment",
        path: part.path,
        mime: part.mime,
      });
    }
    if (part.type === "image" && part.path && !part.url) {
      pendingStaged.push({
        type: "image",
        name: part.filename ?? "image",
        path: part.path,
        mime: part.mime,
      });
    }
    if (part.type === "resource_link" && part.uri) {
      blocks.push({
        type: "resource_link",
        name: part.filename ?? "resource",
        uri: part.uri,
        mime: part.mime,
      });
    }
    return [];
  });
  if (files.length > 0) {
    blocks.push(...await stageWorkspaceAttachments({
      workspaceRoot: input.workspaceRoot,
      sessionId: input.sessionId,
      dataRoot: input.dataRoot,
      files,
    }));
  }
  for (const staged of pendingStaged) {
    const contained = await assertStagedPathInSessionRoot({
      sessionId: input.sessionId,
      path: staged.path,
      dataRoot: input.dataRoot,
    });
    blocks.push(
      staged.type === "image"
        ? { type: "image", name: staged.name, path: contained, mime: staged.mime }
        : { type: "staged_file", name: staged.name, path: contained, mime: staged.mime },
    );
  }
  return grokPromptFromBlocks(blocks);
}

/** Client-supplied staged paths must already live under this session's staging root. */
export async function assertStagedPathInSessionRoot(input: {
  sessionId: string;
  path: string;
  dataRoot?: string;
}): Promise<string> {
  const sessionRoot = await prepareSessionStagingRoot(input.sessionId, input.dataRoot);
  const resolved = resolve(input.path);
  const real = await realpathOrReject(
    resolved,
    "grok_attachment_outside_staging",
    "Grok staged files must already exist in the session staging root",
  );
  return assertInside(
    sessionRoot,
    real,
    "grok_attachment_outside_staging",
    "Grok staged files must stay inside the session staging root",
  );
}

export function grokPromptFromBlocks(blocks: readonly CanonicalPromptBlock[]): Array<{ type: "text"; text: string }> {
  const lines = blocks.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "resource_link") return `Attached resource ${block.name}: ${block.uri}`;
    if (block.type === "staged_file" && block.content) {
      return `Attached file ${block.name}:\n\n${block.content}`;
    }
    return `Attached file ${block.name} is staged at ${block.path}. Read it with read_file.`;
  }).filter((line) => line.trim());
  return [{ type: "text", text: lines.join("\n\n") }];
}

const MIME_EXTENSION: Record<string, string> = {
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/json": ".json",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

function isDataUrl(url: string): boolean {
  return /^data:/i.test(url.trim());
}

function parseDataUrl(url: string): { mime: string; bytes: Buffer } {
  const match = url.trim().match(/^data:([^,]*),(.*)$/su);
  if (!match) {
    throw new ApiError(400, "grok_attachment_invalid", "Grok data attachment is invalid");
  }
  const meta = match[1] ?? "";
  const payload = match[2] ?? "";
  const mime = (meta.split(";")[0] || "application/octet-stream").trim() || "application/octet-stream";
  const bytes = /(?:^|;)base64(?:;|$)/i.test(meta)
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { mime, bytes };
}

async function stageDataUrlAttachment(
  file: { url: string; filename?: string; mime?: string },
  stagingRoot: string,
): Promise<CanonicalPromptBlock> {
  const parsed = parseDataUrl(file.url);
  if (parsed.bytes.length > MAX_BYTES) {
    throw new ApiError(400, "grok_attachment_too_large", "Grok attachment exceeds the size limit");
  }
  const mime = file.mime?.trim() || parsed.mime;
  const hintedName = sanitizeName(file.filename ?? "attachment");
  const extension = extname(hintedName).toLowerCase() || MIME_EXTENSION[mime] || "";
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new ApiError(400, "grok_attachment_type", "Grok attachment type is not allowed");
  }
  const name = extname(hintedName) ? hintedName : `${hintedName}${extension}`;
  const target = join(stagingRoot, `${randomUUID()}-${name}`);
  await writeFile(target, parsed.bytes);
  const stagedPath = assertInside(
    stagingRoot,
    await realpathOrReject(
      target,
      "grok_attachment_invalid",
      "Grok attachment staging escaped the runtime root",
    ),
    "grok_attachment_invalid",
    "Grok attachment staging escaped the runtime root",
  );
  const content = TEXT_EXTENSIONS.has(extension)
    ? parsed.bytes.toString("utf8")
    : undefined;
  return mime.startsWith("image/")
    ? { type: "image", name, path: stagedPath, mime }
    : {
      type: "staged_file",
      name,
      path: stagedPath,
      mime,
      ...(content !== undefined ? { content } : {}),
    };
}

async function prepareSessionStagingRoot(sessionId: string, dataRoot?: string): Promise<string> {
  const stagingRoot = resolveGrokAttachmentStagingRoot(dataRoot);
  const sessionRoot = join(stagingRoot, sanitizeName(sessionId));
  await mkdir(sessionRoot, { recursive: true });
  const realSession = await realpathOrReject(
    sessionRoot,
    "grok_attachment_invalid",
    "Grok attachment staging root is invalid",
  );
  const realRoot = await realpathOrReject(
    stagingRoot,
    "grok_attachment_invalid",
    "Grok attachment staging root is invalid",
  );
  const relativePath = relative(realRoot, realSession);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ApiError(400, "grok_attachment_invalid", "Grok attachment staging escaped the runtime root");
  }
  return realSession;
}

async function realpathOrReject(path: string, code: string, message: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    throw new ApiError(400, code, message);
  }
}

async function realpathIfExists(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function assertInside(
  root: string,
  candidate: string,
  code: string,
  message: string,
): string {
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ApiError(400, code, message);
  }
  if (relativePath.split(/[\\/]/).includes("..")) {
    throw new ApiError(400, code, message);
  }
  return candidate;
}

function resolveWorkspaceFile(workspaceRoot: string, url: string): string {
  const raw = url.replace(/^file:\/\//, "");
  return isAbsolute(raw) ? resolve(raw) : resolve(workspaceRoot, raw);
}

function assertLexicalInside(workspaceRoot: string, candidate: string): void {
  const relativePath = relative(workspaceRoot, candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ApiError(
      400,
      "grok_attachment_outside_workspace",
      "Grok attachments must stay inside the workspace",
    );
  }
}

function sanitizeName(value: string): string {
  const name = value.trim().replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return name || "attachment";
}

export function grokStagingUsesWorkspaceCopy(path: string): boolean {
  return path.split(sep).join("/").includes(".onmyagent-runtime/grok-staging");
}
