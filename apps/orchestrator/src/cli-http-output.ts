/**
 * CLI HTTP, stdout, clipboard, and client-auth helpers.
 * Extracted from cli-shared.ts (mechanical split; re-exported for compat).
 */
import type { ParsedArgs } from "./cli-args.js";
import { readFlag } from "./cli-args.js";
import type { Logger } from "./cli-logging.js";
import type { FieldsResult } from "./cli-types.js";
import { spawnProcess } from "./runtime-services.js";

export function unwrap<T>(result: FieldsResult<T>): T {
  if (result.data !== undefined) {
    return result.data;
  }
  const message =
    result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
  throw new Error(message || "Unknown error");
}

export async function fetchJson<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof (payload as { message?: unknown }).message === "string"
        ? ` ${(payload as { message: string }).message}`
        : "";
    throw new Error(`HTTP ${response.status}${message}`);
  }
  return payload as T;
}

export async function issueOnMyAgentOwnerToken(
  baseUrl: string,
  hostToken: string,
  label = "OnMyAgent owner token",
): Promise<string> {
  const payload = await fetchJson(`${baseUrl.replace(/\/$/, "")}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OnMyAgent-Host-Token": hostToken,
    },
    body: JSON.stringify({ scope: "owner", label }),
  });
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  if (!token) {
    throw new Error("OnMyAgent server did not return an owner token");
  }
  return token;
}

export function normalizeEvent(raw: unknown): { type: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.type === "string") return { type: record.type };
  const payload = record.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload.type === "string")
    return { type: payload.type };
  return null;
}


export function outputResult(payload: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (typeof payload === "string") {
    console.log(payload);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

export function outputError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    return;
  }
  console.error(message);
}

export function createVerboseLogger(
  enabled: boolean,
  logger?: Logger,
  component = "onmyagent-orchestrator",
) {
  return (message: string) => {
    if (!enabled) return;
    if (logger) {
      logger.debug(message, undefined, component);
      return;
    }
    console.log(`[${component}] ${message}`);
  };
}

export function buildAttachCommand(input: {
  url: string;
  workspace: string;
  username?: string;
  password?: string;
}): string {
  const parts: string[] = [];
  if (input.username && input.password) {
    parts.push(`OPENCODE_SERVER_USERNAME=${input.username}`);
  }
  if (input.password) {
    parts.push(`OPENCODE_SERVER_PASSWORD=${input.password}`);
  }
  parts.push("opencode", "attach", input.url, "--dir", input.workspace);
  return parts.join(" ");
}

export async function runClipboardCommand(
  command: string,
  args: string[],
  text: string,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawnProcess(command, args, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => resolve(false));
    child.stdin?.write(text);
    child.stdin?.end();
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function copyToClipboard(
  text: string,
): Promise<{ copied: boolean; error?: string }> {
  const platform = process.platform;
  const commands: Array<{ command: string; args: string[] }> = [];
  if (platform === "darwin") {
    commands.push({ command: "pbcopy", args: [] });
  } else if (platform === "win32") {
    commands.push({ command: "clip", args: [] });
  } else {
    commands.push({ command: "wl-copy", args: [] });
    commands.push({ command: "xclip", args: ["-selection", "clipboard"] });
    commands.push({ command: "xsel", args: ["--clipboard", "--input"] });
  }
  for (const entry of commands) {
    try {
      const ok = await runClipboardCommand(entry.command, entry.args, text);
      if (ok) return { copied: true };
    } catch {
      // ignore
    }
  }
  return { copied: false, error: "Clipboard unavailable" };
}
export function readOnMyAgentClientAuth(args: ParsedArgs): {
  onmyagentUrl: string;
  token: string;
} {
  const onmyagentUrl =
    readFlag(args.flags, "onmyagent-url") ??
    process.env.ONMYAGENT_URL ??
    process.env.ONMYAGENT_SERVER_URL ??
    "";
  const token =
    readFlag(args.flags, "token") ??
    readFlag(args.flags, "onmyagent-token") ??
    process.env.ONMYAGENT_TOKEN ??
    "";

  if (!onmyagentUrl || !token) {
    throw new Error("onmyagent-url and token are required");
  }

  return { onmyagentUrl, token };
}

export function readSessionId(args: ParsedArgs, fallbackIndex: number): string {
  const sessionId =
    readFlag(args.flags, "session-id") ?? args.positionals[fallbackIndex] ?? "";
  const trimmed = sessionId.trim();
  if (!trimmed) {
    throw new Error("session-id is required");
  }
  return trimmed;
}
