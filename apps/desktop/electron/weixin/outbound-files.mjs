import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { assertWeixinMediaUrl } from "./media.mjs";

export const MAX_OUTBOUND_FILE_COUNT = 8;
export const MAX_OUTBOUND_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_OUTBOUND_TOTAL_BYTES = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  ".7z", ".avi", ".bmp", ".bz2", ".csv", ".diff", ".doc", ".docx",
  ".flac", ".gif", ".gz", ".jpeg", ".jpg", ".json", ".log", ".m4a",
  ".markdown", ".md", ".mov", ".mp3", ".mp4", ".odf", ".odp", ".ods",
  ".odt", ".ogg", ".patch", ".pdf", ".png", ".ppt", ".pptx", ".rar",
  ".rtf", ".tar", ".tgz", ".tif", ".tiff", ".tsv", ".txt", ".wav",
  ".webm", ".webp", ".xls", ".xlsx", ".xml", ".xz", ".yaml", ".yml",
  ".zip",
]);

const DENIED_EXTENSIONS = new Set([
  ".app", ".bat", ".cer", ".cmd", ".com", ".crt", ".dll", ".dylib", ".env",
  ".exe", ".hta", ".html", ".js", ".key", ".mjs", ".msi", ".p12", ".pem",
  ".ps1", ".py", ".sh", ".svg", ".ts", ".vbs",
]);

const SENSITIVE_NAME = /(?:^|[._-])(?:auth|credentials?|id_ed25519|id_rsa|private[_-]?key|secrets?|tokens?)(?:[._-]|$)/i;
const MARKDOWN_LINK = /\[([^\]\r\n]*)\]\((<[^>\r\n]+>|[^)\r\n]+)\)/g;

function decodeLinkTarget(value) {
  const raw = String(value ?? "").trim();
  const unwrapped = raw.startsWith("<") && raw.endsWith(">")
    ? raw.slice(1, -1).trim()
    : raw.split(/\s+["']/u, 1)[0].trim();
  try {
    return decodeURIComponent(unwrapped);
  } catch {
    return unwrapped;
  }
}

function normalizeLocalPath(value) {
  let target = decodeLinkTarget(value);
  if (/^file:\/\/\//i.test(target)) target = target.slice("file:///".length);
  if (/^\/[A-Za-z]:[\\/]/.test(target)) target = target.slice(1);
  if (process.platform === "win32") target = target.replaceAll("/", "\\");
  const absolute = process.platform === "win32"
    ? /^[A-Za-z]:[\\/]/.test(target) || target.startsWith("\\\\")
    : target.startsWith("/");
  return absolute ? path.normalize(target) : "";
}

export function extractLocalMarkdownLinks(output) {
  const links = [];
  for (const match of String(output ?? "").matchAll(MARKDOWN_LINK)) {
    const filePath = normalizeLocalPath(match[2]);
    if (!filePath) continue;
    links.push({
      fullMatch: match[0],
      label: String(match[1] ?? "").trim(),
      filePath,
      index: match.index ?? 0,
    });
  }
  return links;
}

function normalizeForComparison(value) {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

const FILE_IDENTITY_FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs"];

function fileIdentity(info) {
  return Object.fromEntries(FILE_IDENTITY_FIELDS.map((field) => [field, String(info?.[field] ?? "")]));
}

function hasSameFileIdentity(left, right) {
  const leftIdentity = left?.dev === undefined ? left : fileIdentity(left);
  const rightIdentity = right?.dev === undefined ? right : fileIdentity(right);
  return FILE_IDENTITY_FIELDS.every((field) => String(leftIdentity?.[field] ?? "") === String(rightIdentity?.[field] ?? ""));
}

async function readVerifiedOutboundFile(attachment) {
  let handle = null;
  try {
    const selectedPath = normalizeForComparison(attachment.path);
    const canonicalBefore = await realpath(attachment.path);
    const expectedPath = attachment.identity ? selectedPath : normalizeForComparison(canonicalBefore);
    if (normalizeForComparison(canonicalBefore) !== expectedPath) throw new Error("file changed before upload");

    const pathBefore = await lstat(attachment.path, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) throw new Error("file changed before upload");
    if (attachment.identity && !hasSameFileIdentity(attachment.identity, pathBefore)) throw new Error("file changed before upload");

    const noFollow = process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number" ? 0 : constants.O_NOFOLLOW;
    handle = await open(attachment.path, constants.O_RDONLY | noFollow);
    const handleBefore = await handle.stat({ bigint: true });
    if (!handleBefore.isFile() || !hasSameFileIdentity(pathBefore, handleBefore)) throw new Error("file changed before upload");

    const plaintext = await handle.readFile();
    const handleAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(attachment.path, { bigint: true });
    const canonicalAfter = await realpath(attachment.path);
    if (
      plaintext.length !== attachment.size
      || pathAfter.isSymbolicLink()
      || !pathAfter.isFile()
      || normalizeForComparison(canonicalAfter) !== expectedPath
      || !hasSameFileIdentity(handleBefore, handleAfter)
      || !hasSameFileIdentity(handleAfter, pathAfter)
    ) {
      throw new Error("file changed before upload");
    }
    return plaintext;
  } catch (error) {
    if (error instanceof Error && error.message === "file changed before upload") throw error;
    throw new Error("file changed before upload", { cause: error });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isInsideRoot(filePath, rootPath) {
  const file = normalizeForComparison(filePath);
  const root = normalizeForComparison(rootPath);
  return file === root || file.startsWith(`${root}${path.sep}`);
}

function rejection(link, name, reason) {
  return { link, name, reason };
}

function displayName(link, filePath) {
  return path.basename(String(link.label || filePath)) || "未命名文件";
}

function withAttemptedTransports(error, attemptedTransports) {
  const deliveryError = error instanceof Error ? error : new Error(String(error));
  const priorAttempts = error && typeof error === "object" && "attemptedTransports" in error
    ? Number(error.attemptedTransports ?? 0)
    : 0;
  return Object.assign(deliveryError, { attemptedTransports: Math.max(
    priorAttempts,
    Number(attemptedTransports ?? 0),
  ) });
}

export function createStoppedWeixinDeliveryError(attemptedTransports) {
  return Object.assign(new Error("Weixin channel stopped during delivery"), { name: "AbortError", attemptedTransports });
}

function assertDeliveryActive(signal, deliveryState = null) {
  if (!signal?.aborted) return;
  throw createStoppedWeixinDeliveryError(Number(deliveryState?.attemptedTransports ?? 0));
}

async function beginTransportAttempt(deliveryState, beforeFirstTransport, signal) {
  if (deliveryState?.attemptedTransports === 0 && beforeFirstTransport) await beforeFirstTransport();
  assertDeliveryActive(signal, deliveryState);
  if (deliveryState) deliveryState.attemptedTransports += 1;
}

function isDeniedName(name) {
  const lower = name.toLowerCase();
  return lower.startsWith(".env") || lower.startsWith(".") || SENSITIVE_NAME.test(lower);
}

export async function selectOutboundFiles({
  output = "",
  artifacts = [],
  allowedRoots = [],
  maxFiles = MAX_OUTBOUND_FILE_COUNT,
  maxFileBytes = MAX_OUTBOUND_FILE_BYTES,
  maxTotalBytes = MAX_OUTBOUND_TOTAL_BYTES,
} = {}) {
  const links = extractLocalMarkdownLinks(output);
  const artifactEntries = (Array.isArray(artifacts) ? artifacts : [])
    .filter((item) => String(item?.kind ?? "file") === "file")
    .map((item) => ({
      name: path.basename(String(item?.name ?? item?.path ?? "")).toLowerCase(),
      path: String(item?.path ?? item?.filePath ?? "").trim(),
    }))
    .filter((item) => item.name);
  const canonicalRoots = [];
  for (const root of allowedRoots) {
    const value = String(root ?? "").trim();
    if (!value) continue;
    const canonical = await realpath(value).catch(() => "");
    if (canonical) canonicalRoots.push(canonical);
  }

  const attachments = [];
  const rejected = [];
  const seen = new Set();
  const selectedLinkIndexes = new Set();
  let totalBytes = 0;

  for (const link of links) {
    const linkedName = path.basename(link.filePath);
    const name = displayName(link, linkedName);
    const matchingArtifacts = artifactEntries.filter((item) => item.name === linkedName.toLowerCase());
    if (matchingArtifacts.length === 0) {
      rejected.push(rejection(link, name, "not-runtime-artifact"));
      continue;
    }
    const lexicalInfo = await lstat(link.filePath).catch(() => null);
    if (!lexicalInfo) {
      rejected.push(rejection(link, name, "missing-file"));
      continue;
    }
    // Never follow a user-visible symlink into a differently named file. The
    // canonical target could otherwise bypass the lexical extension/name
    // policy (for example report.txt -> .env).
    if (lexicalInfo.isSymbolicLink()) {
      rejected.push(rejection(link, name, "not-regular-file"));
      continue;
    }
    const canonical = await realpath(link.filePath).catch(() => "");
    if (!canonical) {
      rejected.push(rejection(link, name, "missing-file"));
      continue;
    }
    const comparisonKey = normalizeForComparison(canonical);
    if (seen.has(comparisonKey)) {
      selectedLinkIndexes.add(link.index);
      continue;
    }
    const artifactPaths = [];
    const hasDeclaredArtifactPath = matchingArtifacts.some((artifact) => Boolean(artifact.path));
    for (const artifact of matchingArtifacts) {
      if (!artifact.path) continue;
      const artifactCanonical = await realpath(artifact.path).catch(() => "");
      if (artifactCanonical) artifactPaths.push(artifactCanonical);
    }
    const matchesRecordedArtifactPath = artifactPaths.some((artifactPath) => normalizeForComparison(artifactPath) === comparisonKey);
    // A declared runtime path is an exact security boundary. If it disappeared
    // or cannot be canonicalized, never downgrade to basename-only matching;
    // otherwise an unrelated same-name file could be substituted.
    if (hasDeclaredArtifactPath && !matchesRecordedArtifactPath) {
      rejected.push(rejection(link, name, "artifact-path-mismatch"));
      continue;
    }
    if (canonicalRoots.length === 0 || !canonicalRoots.some((root) => isInsideRoot(canonical, root))) {
      rejected.push(rejection(link, name, "outside-workspace"));
      continue;
    }
    const info = await stat(canonical, { bigint: true }).catch(() => null);
    if (!info?.isFile()) {
      rejected.push(rejection(link, name, "not-regular-file"));
      continue;
    }
    const canonicalName = path.basename(canonical);
    const extension = path.extname(linkedName).toLowerCase();
    const canonicalExtension = path.extname(canonicalName).toLowerCase();
    if (isDeniedName(linkedName) || isDeniedName(canonicalName) || DENIED_EXTENSIONS.has(extension) || DENIED_EXTENSIONS.has(canonicalExtension)) {
      rejected.push(rejection(link, name, "sensitive-or-executable"));
      continue;
    }
    if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_EXTENSIONS.has(canonicalExtension)) {
      rejected.push(rejection(link, name, "unsupported-type"));
      continue;
    }
    const fileSize = Number(info.size);
    if (fileSize > maxFileBytes) {
      rejected.push(rejection(link, name, "file-too-large"));
      continue;
    }
    if (attachments.length >= maxFiles) {
      rejected.push(rejection(link, name, "too-many-files"));
      continue;
    }
    if (totalBytes + fileSize > maxTotalBytes) {
      rejected.push(rejection(link, name, "total-too-large"));
      continue;
    }
    seen.add(comparisonKey);
    selectedLinkIndexes.add(link.index);
    totalBytes += fileSize;
    attachments.push({ path: canonical, name: linkedName, size: fileSize, identity: fileIdentity(info), link });
  }

  let cleanedOutput = String(output ?? "");
  for (const link of [...links].reverse()) {
    const selected = selectedLinkIndexes.has(link.index);
    const name = displayName(link, link.filePath);
    const replacement = selected ? name : `${name}（未发送）`;
    cleanedOutput = `${cleanedOutput.slice(0, link.index)}${replacement}${cleanedOutput.slice(link.index + link.fullMatch.length)}`;
  }

  return { attachments, rejected, cleanedOutput, hadLocalLinks: links.length > 0, totalBytes };
}

export function aesEcbPaddedSize(size) {
  return Math.ceil((Number(size) + 1) / 16) * 16;
}

export function encryptAes128Ecb(plaintext, key) {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function buildCdnUploadUrl({ cdnBaseUrl, uploadParam, fileKey }) {
  const base = String(cdnBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base || !uploadParam || !fileKey) throw new Error("Weixin CDN upload parameters are incomplete");
  return assertWeixinMediaUrl(`${base}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(fileKey)}`);
}

export async function deliverOutboundFiles({
  output = "",
  artifacts = [],
  allowedRoots = [],
  client,
  account,
  chatId,
  peerId = chatId,
  agent,
  readContextToken,
  setSentCount,
  appendLog,
  assertResponse,
  sendText,
  formatReply,
  signal = null,
  beforeFirstTransport = null,
}) {
  const deliveryState = { attemptedTransports: 0 };
  assertDeliveryActive(signal, deliveryState);
  const selection = await selectOutboundFiles({ output, artifacts, allowedRoots });
  assertDeliveryActive(signal, deliveryState);
  const contextToken = await readContextToken(peerId || chatId);
  assertDeliveryActive(signal, deliveryState);
  const delivered = [];
  const failures = selection.rejected.map(describeOutboundFileRejection);
  for (const attachment of selection.attachments) {
    assertDeliveryActive(signal, deliveryState);
    try {
      const response = await uploadAndSendOutboundFile({ client, account, to: chatId, contextToken, attachment, signal, deliveryState, beforeFirstTransport });
      assertDeliveryActive(signal, deliveryState);
      assertResponse(response, `send file ${attachment.name}`);
      delivered.push(attachment.name);
      setSentCount();
    } catch (error) {
      if (error?.retryTerminalDelivery === true) throw error;
      if (signal?.aborted) throw withAttemptedTransports(error, deliveryState.attemptedTransports);
      const safeError = describeOutboundDeliveryError(error);
      failures.push(`${attachment.name}：${safeError}`);
      appendLog({ type: "error", text: `weixin outbound file failed (${attachment.name}): ${safeError}` });
    }
  }
  const statusLines = [
    delivered.length ? `附件已发送：${delivered.join("、")}` : "",
    failures.length ? `附件发送失败：\n${failures.map((item) => `- ${item}`).join("\n")}` : "",
  ].filter(Boolean);
  const body = [selection.cleanedOutput.trim(), ...statusLines].filter(Boolean).join("\n\n");
  assertDeliveryActive(signal, deliveryState);
  try {
    await sendText(
      formatReply({ agent, text: body }),
      peerId,
      deliveryState.attemptedTransports === 0 ? beforeFirstTransport : null,
    );
    deliveryState.attemptedTransports = Math.max(1, deliveryState.attemptedTransports);
  } catch (error) {
    throw withAttemptedTransports(error, deliveryState.attemptedTransports);
  }
  assertDeliveryActive(signal, deliveryState);
  return { delivered, failures };
}

export async function uploadAndSendOutboundFile({ client, account, to, contextToken, attachment, signal = null, deliveryState = null, beforeFirstTransport = null }) {
  assertDeliveryActive(signal, deliveryState);
  const plaintext = await readVerifiedOutboundFile(attachment);
  assertDeliveryActive(signal, deliveryState);
  const fileKey = randomBytes(16).toString("hex");
  const aesKey = randomBytes(16);
  const aesKeyHex = aesKey.toString("hex");
  const md5 = createHash("md5").update(plaintext).digest("hex");
  const uploadResponse = await client.getUploadUrl({
    baseUrl: account.baseUrl,
    token: account.token,
    fileKey,
    mediaType: 3,
    toUserId: to,
    rawSize: plaintext.length,
    rawFileMd5: md5,
    encryptedSize: aesEcbPaddedSize(plaintext.length),
    aesKey: aesKeyHex,
    signal,
  });
  assertDeliveryActive(signal, deliveryState);
  const ret = Number(uploadResponse?.ret ?? 0);
  const errcode = Number(uploadResponse?.errcode ?? 0);
  if (ret !== 0 || errcode !== 0) {
    const message = String(uploadResponse?.errmsg ?? uploadResponse?.message ?? "").trim();
    throw new Error(`getuploadurl failed ret=${ret} errcode=${errcode}${message ? `: ${message}` : ""}`);
  }
  const fullUploadUrl = String(uploadResponse?.upload_full_url ?? "").trim();
  const uploadUrl = fullUploadUrl
    ? assertWeixinMediaUrl(fullUploadUrl)
    : buildCdnUploadUrl({ cdnBaseUrl: account.cdnBaseUrl, uploadParam: uploadResponse?.upload_param, fileKey });
  const encrypted = encryptAes128Ecb(plaintext, aesKey);
  const uploaded = await client.uploadCdn({ uploadUrl, encrypted, signal });
  assertDeliveryActive(signal, deliveryState);
  const encryptedQueryParam = String(uploaded?.encryptedQueryParam ?? "").trim();
  if (!encryptedQueryParam) throw new Error("CDN upload response did not include x-encrypted-param");
  await beginTransportAttempt(deliveryState, beforeFirstTransport, signal);
  const response = await client.sendMessageItem({
    baseUrl: account.baseUrl,
    token: account.token,
    to,
    contextToken,
    clientId: `studio-weixin-file-${randomUUID()}`,
    signal,
    item: {
      type: 4,
      file_item: {
        media: {
          encrypt_query_param: encryptedQueryParam,
          aes_key: Buffer.from(aesKeyHex, "utf8").toString("base64"),
          encrypt_type: 1,
        },
        file_name: attachment.name,
        len: String(plaintext.length),
      },
    },
  });
  assertDeliveryActive(signal, deliveryState);
  return response;
}

export function describeOutboundFileRejection(item) {
  const messages = {
    "file-too-large": "文件超过 25 MB 上限",
    "artifact-path-mismatch": "链接路径与本次 Agent 记录的产物路径不一致",
    "missing-file": "本地文件不存在",
    "not-regular-file": "目标不是普通文件",
    "not-runtime-artifact": "不是本次 Agent 明确产出的文件",
    "outside-workspace": "文件不在本次任务允许的工作区内",
    "sensitive-or-executable": "文件类型可能包含凭据或可执行内容",
    "too-many-files": "本次附件数量超过上限",
    "total-too-large": "本次附件总大小超过 50 MB 上限",
    "unsupported-type": "微信附件安全白名单不包含此文件类型",
  };
  return `${item.name}：${messages[item.reason] ?? "未通过附件安全检查"}`;
}

export function describeOutboundDeliveryError(error) {
  const message = String(error instanceof Error ? error.message : error ?? "");
  if (message.includes("file changed before upload")) return "文件在发送前发生变化，请重新生成后再试";
  if (message.includes("host is not allowed") || message.includes("must use https")) return "微信返回了不受信任的上传地址，已阻止发送";
  if (message.includes("getuploadurl")) return "微信上传授权失败，请重新登录后再试";
  if (message.includes("CDN upload")) return "微信文件上传失败，请稍后重试";
  return "微信附件传输失败，请稍后重试";
}

export const __test__ = {
  ALLOWED_EXTENSIONS,
  DENIED_EXTENSIONS,
  normalizeLocalPath,
};
