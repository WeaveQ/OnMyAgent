/**
 * Pi session store — enumerates and deletes pi sessions under the managed
 * `--session-dir` (flat JSONL files: `<timestamp>_<sessionId>.jsonl`).
 *
 * Pi has no list/delete RPC commands, so the engine manages its own index.
 */

import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionSummary } from "../types.js";

const SESSION_FILE_RE = /^\d{4}-\d{2}-\d{2}T.*_[0-9a-fA-F-]+\.jsonl$/;

export function managedSessionDir(profileRoot: string, workspaceHash: string): string {
  return join(profileRoot, "pi-sessions", workspaceHash);
}

function hashWorkspace(cwd: string): string {
  let h = 0;
  for (let i = 0; i < cwd.length; i++) {
    h = (h * 31 + cwd.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export async function listPiSessions(dir: string): Promise<SessionSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const sessions: SessionSummary[] = [];
  for (const name of entries) {
    if (!SESSION_FILE_RE.test(name)) continue;
    const filePath = join(dir, name);
    let mtime: Date;
    try {
      mtime = (await stat(filePath)).mtime;
    } catch {
      continue;
    }
    const sessionId = name.replace(/^\d{4}-\d{2}-\d{2}T.*_/, "").replace(/\.jsonl$/, "");
    const title = await readSessionTitle(filePath, name);
    sessions.push({
      id: sessionId,
      engine: "pi",
      title: title ?? undefined,
      updatedAt: mtime.toISOString(),
      directory: undefined,
    });
  }
  // Most recently updated first.
  sessions.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return sessions;
}

async function readSessionTitle(filePath: string, fallbackName: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf8");
    let firstUserText: string | null = null;
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const type = String(obj.type ?? "");
      if (type === "session_info") {
        const name = obj.name ?? obj.title;
        if (typeof name === "string" && name.trim()) return name.trim();
      }
      if (type === "message") {
        const message = obj.message as { role?: string; content?: unknown } | undefined;
        if (message?.role === "user") {
          const content = message.content;
          if (typeof content === "string" && content.trim()) {
            firstUserText = content.trim().slice(0, 60);
          } else if (Array.isArray(content)) {
            const text = content
              .filter((part): part is { type?: string; text?: string } =>
                Boolean(part && typeof part === "object"),
              )
              .filter((part) => part.type === "text")
              .map((part) => part.text ?? "")
              .join(" ")
              .trim()
              .slice(0, 60);
            if (text) firstUserText = text;
          }
        }
      }
      if (firstUserText && !(type === "message")) {
        // Continue scanning; session_info may still appear after messages.
      }
    }
    if (firstUserText) return firstUserText;
  } catch {
    // fall through
  }
  return fallbackName;
}

export async function deletePiSessionFile(dir: string, sessionId: string): Promise<boolean> {
  const fileName = await findSessionFile(dir, sessionId);
  if (!fileName) return false;
  await rm(join(dir, fileName), { force: true });
  return true;
}

export async function findSessionFile(dir: string, sessionId: string): Promise<string | null> {
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      if (!SESSION_FILE_RE.test(name)) continue;
      if (name.includes(sessionId)) return name;
    }
  } catch {
    // ignore
  }
  return null;
}

export { hashWorkspace };
