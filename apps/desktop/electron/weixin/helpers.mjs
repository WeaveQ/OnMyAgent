import { createHash } from "node:crypto";
import { createQrSvgDataUrl } from "./local-qr.mjs";

export const SESSION_EXPIRED_ERRCODE = -14;
export const RATE_LIMIT_ERRCODE = -2;
export const RETRY_DELAY_SECONDS = 2;
export const BACKOFF_DELAY_SECONDS = 30;
export const MESSAGE_DEDUP_TTL_MS = 5 * 60_000;
export const DEFAULT_TEXT_BATCH_DELAY_MS = 3_000;
export const DEFAULT_HISTORY_LIMIT = 12;
export const DEFAULT_HISTORY_STORE_LIMIT = 24;
export const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
export const ACTIVE_RUN_PENDING_POLL_INTERVAL_MS = 3_000;
// Minimum spacing between "agent still busy" replies for the same chat+agent,
// so quickly re-sending messages does not flood the IM chat with duplicates.
export const AGENT_BUSY_NOTICE_INTERVAL_MS = 15_000;
// Backstop ceiling for a single channel conversation lock. The personal agent
// runtime already enforces its own run timeout (max 12h), but that timer lives
// in the runtime process and is lost if the desktop app restarts.
export const ACTIVE_RUN_MAX_AGE_MS = 12 * 60 * 60 * 1000 + 15 * 60 * 1000;

export function sleep(ms, signal = null) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function safeId(value, keep = 8) {
  const raw = String(value ?? "").trim();
  if (!raw) return "?";
  return raw.length <= keep ? raw : raw.slice(0, keep);
}

export function isStaleSessionRet(ret, errcode, errmsg) {
  if (ret !== RATE_LIMIT_ERRCODE && errcode !== RATE_LIMIT_ERRCODE) return false;
  return String(errmsg ?? "").toLowerCase() === "unknown error";
}

export function createQrImageDataUrl(scanData) {
  const cleanData = String(scanData ?? "").trim();
  if (!cleanData) return { dataUrl: "", error: "missing QR scan data" };
  if (cleanData.startsWith("data:image/")) return { dataUrl: cleanData, error: null };
  try {
    return { dataUrl: createQrSvgDataUrl(cleanData), error: null };
  } catch (error) {
    return { dataUrl: "", error: error instanceof Error ? error.message : String(error) };
  }
}

export function extractText(itemList = []) {
  for (const item of itemList) {
    if (item?.type === 1) {
      const text = String(item?.text_item?.text ?? "");
      const refItem = item?.ref_msg?.message_item;
      if (refItem?.type) {
        const refText = extractText([refItem]);
        const title = item?.ref_msg?.title ? String(item.ref_msg.title) : "";
        if (refText || title) return `[引用: ${[title, refText].filter(Boolean).join(" | ")}]\n${text}`.trim();
      }
      return text;
    }
  }
  for (const item of itemList) {
    if (item?.type === 3) {
      const voiceText = String(item?.voice_item?.text ?? "");
      if (voiceText) return voiceText;
    }
  }
  return "";
}

export function guessChatType(message, accountId) {
  const roomId = String(message?.room_id ?? message?.chat_room_id ?? "").trim();
  const toUserId = String(message?.to_user_id ?? "").trim();
  const isGroup = Boolean(roomId) || (toUserId && accountId && toUserId !== accountId && message?.msg_type === 1);
  if (isGroup) return { chatType: "group", chatId: roomId || toUserId || String(message?.from_user_id ?? "") };
  return { chatType: "dm", chatId: String(message?.from_user_id ?? "") };
}

export function splitTextForWeixin(text, maxLength = 2000) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  if (raw.length <= maxLength) return [raw];
  const chunks = [];
  let rest = raw;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf("\n\n", maxLength);
    if (cut < maxLength * 0.5) cut = rest.lastIndexOf("\n", maxLength);
    if (cut < maxLength * 0.5) cut = rest.lastIndexOf("。", maxLength);
    if (cut < maxLength * 0.5) cut = maxLength;
    const splitSurrogatePair = /[\uD800-\uDBFF]/u.test(rest[cut - 1] ?? "") && /[\uDC00-\uDFFF]/u.test(rest[cut] ?? "");
    if (splitSurrogatePair) cut -= 1;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

export class TtlSet {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.items = new Map();
  }

  hasOrAdd(key) {
    const now = Date.now();
    for (const [item, at] of this.items) {
      if (now - at > this.ttlMs) this.items.delete(item);
    }
    if (this.items.has(key)) return true;
    this.items.set(key, now);
    return false;
  }
}

export function stableHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

export function safeSegment(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.@-]/g, "_").slice(0, 48) || "default";
}

export function chatAgentHistoryKey(chatId, agent) {
  return `${String(chatId ?? "").trim()}::agent:${agent.provider}/${agent.id}`;
}

export function activeRunKey(chatId, agent) {
  return `${String(chatId ?? "").trim()}::agent:${agent.provider}/${agent.id}`;
}

export function activeRunGuardKey(accountId, runKey) {
  return `${String(accountId ?? "").trim()}:${String(runKey ?? "").trim()}`;
}

export function mimeFromFilename(filename) {
  const lower = String(filename ?? "").toLowerCase();
  if (/\.(jpe?g)$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.mp4$/.test(lower)) return "video/mp4";
  if (/\.pdf$/.test(lower)) return "application/pdf";
  if (/\.txt$/.test(lower)) return "text/plain";
  return "application/octet-stream";
}
