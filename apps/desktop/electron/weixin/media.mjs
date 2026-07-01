import { createDecipheriv } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

const ALLOWED_WEIXIN_MEDIA_HOSTS = new Set([
  "novac2c.cdn.weixin.qq.com",
  "ilinkai.weixin.qq.com",
  "wx.qlogo.cn",
  "thirdwx.qlogo.cn",
  "res.wx.qq.com",
  "mmbiz.qpic.cn",
  "mmbiz.qlogo.cn",
]);

export function parseAesKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("aes key is required");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32) {
    const text = decoded.toString("ascii");
    if (/^[0-9a-fA-F]{32}$/.test(text)) return Buffer.from(text, "hex");
  }
  if (/^[0-9a-fA-F]{32}$/.test(raw)) return Buffer.from(raw, "hex");
  throw new Error(`unexpected aes key format (${decoded.length} decoded bytes)`);
}

export function aes128EcbDecrypt(ciphertext, key) {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
}

export function assertWeixinMediaUrl(rawUrl) {
  const parsed = new URL(String(rawUrl ?? ""));
  if (parsed.protocol !== "https:") {
    throw new Error(`Weixin media URL must use https: ${parsed.protocol}`);
  }
  if (!ALLOWED_WEIXIN_MEDIA_HOSTS.has(parsed.hostname)) {
    throw new Error(`Weixin media URL host is not allowed: ${parsed.hostname}`);
  }
  return parsed.toString();
}

export function cdnDownloadUrl(cdnBaseUrl, encryptedQueryParam) {
  const base = String(cdnBaseUrl ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("cdnBaseUrl is required");
  const url = `${base}/download?encrypted_query_param=${encodeURIComponent(String(encryptedQueryParam ?? ""))}`;
  return assertWeixinMediaUrl(url);
}

export function mediaReference(item, key) {
  return item?.[key]?.media ?? {};
}

export function mediaUrlFromReference({ cdnBaseUrl, media }) {
  const encryptedQueryParam = String(media?.encrypt_query_param ?? "").trim();
  if (encryptedQueryParam) return cdnDownloadUrl(cdnBaseUrl, encryptedQueryParam);
  const fullUrl = String(media?.full_url ?? "").trim();
  if (fullUrl) return assertWeixinMediaUrl(fullUrl);
  throw new Error("media item had neither encrypt_query_param nor full_url");
}

export async function downloadAndDecryptMedia({ fetchFn = globalThis.fetch, url, aesKey, outputDir, filename = "weixin-media.bin" }) {
  if (typeof fetchFn !== "function") throw new Error("fetch is required for Weixin media download");
  const safeUrl = assertWeixinMediaUrl(url);
  const response = await fetchFn(safeUrl);
  if (!response.ok) throw new Error(`Weixin media download HTTP ${response.status}`);
  const encrypted = Buffer.from(await response.arrayBuffer());
  const decrypted = aes128EcbDecrypt(encrypted, parseAesKey(aesKey));
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, path.basename(filename) || "weixin-media.bin");
  await writeFile(outputPath, decrypted);
  return outputPath;
}

export const __test__ = {
  ALLOWED_WEIXIN_MEDIA_HOSTS,
};
