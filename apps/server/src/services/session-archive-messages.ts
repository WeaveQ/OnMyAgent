import { open, stat } from "node:fs/promises";
import type { SessionArchiveAgent } from "@onmyagent/types/session-archive";

// cc-switch parity message loader.
// Reads a source file on demand (no persistent parse pipeline), returning
// role/content/timestamp tuples. Supports the JSONL agents cc-switch covers
// today (codex / claude / gemini / openclaw); other agents receive a
// best-effort fallback that pipes any recognizable role/content pair.

export type SessionArchiveMessageRow = {
  role: string;
  content: string;
  timestamp: string | null;
};

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export async function loadSessionArchiveMessagesFromFile(input: {
  agent: SessionArchiveAgent;
  filePath: string;
  limit?: number;
}): Promise<SessionArchiveMessageRow[]> {
  const info = await safeStat(input.filePath);
  if (!info || info.size === 0) return [];
  const bytesToRead = Math.min(info.size, MAX_MESSAGE_BYTES);
  const handle = await safeOpen(input.filePath);
  if (!handle) return [];
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const rows = extractMessages(input.agent, text);
    return input.limit !== undefined ? rows.slice(-input.limit) : rows;
  } finally {
    await handle.close();
  }
}

export function extractMessages(agent: SessionArchiveAgent, text: string): SessionArchiveMessageRow[] {
  const rows: SessionArchiveMessageRow[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parsed = safeJson(trimmed);
    if (parsed === null) continue;
    const row = mapRecordToMessage(agent, parsed);
    if (row !== null) rows.push(row);
  }
  return rows;
}

function mapRecordToMessage(agent: SessionArchiveAgent, record: Record<string, unknown>): SessionArchiveMessageRow | null {
  const role = detectRole(record);
  if (role === null) return null;
  const content = detectContent(record);
  if (content === null) return null;
  const timestamp = detectTimestamp(record);
  // `agent` retained for future per-agent shape refinements.
  void agent;
  return { role, content, timestamp };
}

function detectRole(record: Record<string, unknown>): string | null {
  if (typeof record.role === "string") return record.role;
  if (typeof record.type === "string") return record.type;
  const message = record.message;
  if (typeof message === "object" && message !== null) {
    const role = (message as Record<string, unknown>).role;
    if (typeof role === "string") return role;
  }
  return null;
}

function detectContent(record: Record<string, unknown>): string | null {
  const direct = record.content;
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) return joinContentBlocks(direct);
  const text = record.text;
  if (typeof text === "string") return text;
  const message = record.message;
  if (typeof message === "object" && message !== null) {
    const nested = detectContent(message as Record<string, unknown>);
    if (nested !== null) return nested;
  }
  return null;
}

function joinContentBlocks(blocks: readonly unknown[]): string | null {
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (typeof block !== "object" || block === null) continue;
    const record = block as Record<string, unknown>;
    if (typeof record.text === "string") parts.push(record.text);
    else if (typeof record.content === "string") parts.push(record.content);
  }
  return parts.length > 0 ? parts.join("") : null;
}

function detectTimestamp(record: Record<string, unknown>): string | null {
  const candidates = ["timestamp", "ts", "createdAt", "created_at", "time"];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  }
  return null;
}

function safeJson(input: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(input);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function safeOpen(filePath: string) {
  try {
    return await open(filePath, "r");
  } catch {
    return null;
  }
}
