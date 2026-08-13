/**
 * Pi engine — managed `pi --mode rpc` processes (JSONL over stdio), one
 * process per session (B1-A), `--session-dir` injected under OnMyAgent's
 * managed directory (B3: sessions never touch the user's ~/.pi).
 *
 * Capabilities (first release): approvals none, no todo/MCP/skills management,
 * jsonl archive, process-per-session concurrency.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import type {
  AgentEngine,
  AgentEngineCapabilities,
  EngineEvent,
  EngineEventCallback,
  ModelInfo,
  SessionDetail,
  SessionRef,
  SessionSummary,
  Unsubscribe,
} from "../types.js";
import { PiRpcProcess, resolvePiBinary, resolvePiNodeBin } from "./rpc-client.js";
import {
  deletePiSessionFile,
  findSessionFile,
  hashWorkspace,
  listPiSessions,
  managedSessionDir,
} from "./session-store.js";

const CAPABILITIES: AgentEngineCapabilities = {
  todo: false,
  mcp: false,
  skills: false,
  skillsLoad: false,
  approvals: "bridge",
  archive: "jsonl",
  multiSession: "process-per-session",
  sessionList: { search: false, pagination: false, multiRoot: false },
  models: "mapped-from-host",
};

interface PoolEntry {
  process: PiRpcProcess;
  sessionFile: string | null;
  idleSince: number;
  timers: NodeJS.Timeout[];
  /** Mutable bridge key: follows the session through the "new" → real-id re-key. */
  sessionKeyRef: { current: string };
}

/** In-flight approval bridge requests awaiting a UI decision. */
interface PendingApproval {
  requestId: string;
  sessionId: string;
  toolName: string;
  title: string;
  message: string;
  createdAt: number;
}

const IDLE_TTL_MS = 60_000;
const MAX_CONCURRENT = 4;

/** Approval bridge extension injected into every managed pi process. */
function resolveApprovalExtensionPath(): string | null {
  const candidates = [
    // dev (bun src) and dist (node build) both live next to this module.
    join(dirname(fileURLToPath(import.meta.url)), "approval-extension.ts"),
    join(dirname(fileURLToPath(import.meta.url)), "approval-extension.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** "bash: rm -rf /" → "bash" */
function toolNameFromApprovalMessage(message: string): string {
  const raw = String(message ?? "").trim();
  const colon = raw.indexOf(":");
  return colon > 0 ? raw.slice(0, colon).trim() : raw.split(/\s+/)[0] ?? "";
}

export class PiEngine implements AgentEngine {
  readonly id = "pi" as const;
  private pool = new Map<string, PoolEntry>();
  private listeners = new Set<EngineEventCallback>();
  private idleTimer: NodeJS.Timeout | null = null;
  private pendingApprovals = new Map<string, PendingApproval>();
  private readonly bin: string;
  private readonly managedDir: string;

  constructor(
    private readonly config: ServerConfig,
    private readonly workspace: WorkspaceInfo,
  ) {
    this.bin = resolvePiBinary();
    const home = homedir();
    const profileRoot = join(home, ".onmyagent", "profiles", "local");
    this.managedDir = managedSessionDir(profileRoot, hashWorkspace(workspace.path));
    try {
      mkdirSync(this.managedDir, { recursive: true });
    } catch {
      // read-only home: fall back to tmp for the session dir
      this.managedDir = managedSessionDir(join(process.env.TMPDIR ?? "/tmp", "onmyagent-pi"), hashWorkspace(workspace.path));
      mkdirSync(this.managedDir, { recursive: true });
    }
  }

  getCapabilities(): AgentEngineCapabilities {
    return CAPABILITIES;
  }

  // ── lifecycle ──────────────────────────────────────────────

  private ensureIdleSweeper() {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, entry] of [...this.pool]) {
        if (entry.process.isRunning() && now - entry.idleSince > IDLE_TTL_MS) {
          void this.disposeSession(sessionId);
        }
      }
    }, 30_000);
    this.idleTimer.unref?.();
  }

  private async spawnSession(sessionId: string): Promise<PiRpcProcess> {
    if (this.pool.size >= MAX_CONCURRENT) {
      // Evict the oldest idle session to make room.
      const oldest = [...this.pool.entries()]
        .filter(([, e]) => e.process.isRunning())
        .sort((a, b) => a[1].idleSince - b[1].idleSince)[0];
      if (oldest) await this.disposeSession(oldest[0]);
    }
    this.ensureIdleSweeper();
    // Event bridge must follow the session through the "new" → real-id re-key.
    const sessionKeyRef: { current: string } = { current: sessionId };
    const proc = new PiRpcProcess({
      bin: this.bin,
      nodeBin: resolvePiNodeBin(),
      sessionDir: this.managedDir,
      cwd: this.workspace.path,
      extension: resolveApprovalExtensionPath(),
      env: this.buildEnv(),
      onEvent: (event) => this.bridgeEvent(sessionKeyRef.current, event),
      onExit: (code, signal) => {
        const entry = this.pool.get(sessionKeyRef.current);
        if (entry) {
          for (const t of entry.timers) clearTimeout(t);
          this.pool.delete(sessionKeyRef.current);
        }
      },
    });
    const entry: PoolEntry = { process: proc, sessionFile: null, idleSince: Date.now(), timers: [], sessionKeyRef };
    this.pool.set(sessionId, entry);

    // Wait for the process to be responsive (get_state round trip).
    const state = await proc.send({ type: "get_state" }, 15_000);
    if (!state.success) {
      await proc.stop();
      this.pool.delete(sessionId);
      throw new Error(`pi RPC failed to start: ${state.error ?? "unknown"}`);
    }
    const sessionFile = (state.data as { sessionFile?: string } | undefined)?.sessionFile ?? null;
    entry.sessionFile = sessionFile;
    entry.idleSince = Date.now();
    return proc;
  }

  private async disposeSession(sessionId: string): Promise<void> {
    const entry = this.pool.get(sessionId);
    if (!entry) return;
    for (const t of entry.timers) clearTimeout(t);
    await entry.process.stop();
    this.pool.delete(sessionId);
  }

  private async acquire(sessionId: string): Promise<PiRpcProcess> {
    const entry = this.pool.get(sessionId);
    if (entry && entry.process.isRunning()) {
      entry.idleSince = Date.now();
      return entry.process;
    }
    if (entry) this.pool.delete(sessionId);
    return this.spawnSession(sessionId);
  }

  /**
   * Acquire a process for a read/restore operation. When the session is not
   * live in the pool (fresh server start, idle eviction), spawn a process and
   * `switch_session` to the session file so get_messages returns the persisted
   * transcript instead of an empty new session.
   */
  private async acquireForRead(sessionId: string): Promise<PiRpcProcess> {
    const entry = this.pool.get(sessionId);
    if (entry && entry.process.isRunning()) {
      entry.idleSince = Date.now();
      return entry.process;
    }
    if (entry) this.pool.delete(sessionId);
    const proc = await this.spawnSession(sessionId);
    const fileName = await findSessionFile(this.managedDir, sessionId);
    if (fileName) {
      const filePath = join(this.managedDir, fileName);
      const switched = await proc.send({ type: "switch_session", sessionPath: filePath }, 15_000);
      if (switched.success) {
        const poolEntry = this.pool.get(sessionId);
        if (poolEntry) poolEntry.sessionFile = fileName;
      }
    }
    return proc;
  }

  private buildEnv(): Record<string, string | undefined> {
    // Provider secrets stay in the server process env; never written to the
    // user's ~/.pi settings (hard constraint: no secret round-trip to desktop).
    const env: Record<string, string | undefined> = {};
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("ANTHROPIC") || key.startsWith("OPENAI") || key.startsWith("DEEPSEEK")
        || key === "OPENROUTER_API_KEY" || key === "GEMINI_API_KEY" || key === "GROQ_API_KEY"
        || key === "XAI_API_KEY" || key === "MISTRAL_API_KEY" || key === "CEREBRAS_API_KEY") {
        env[key] = process.env[key];
      }
    }
    return env;
  }

  // ── events ─────────────────────────────────────────────────

  private bridgeEvent(sessionId: string, event: Record<string, unknown>) {
    const type = String(event.type ?? "");
    switch (type) {
      case "agent_start":
      case "turn_start":
        this.emit({ type: "session_status", sessionId, status: "busy" });
        break;
      case "agent_end":
      case "agent_settled":
      case "turn_end":
        this.emit({ type: "session_status", sessionId, status: "idle" });
        break;
      case "message_update": {
        const raw = event.assistantMessageEvent;
        const ev = (raw && typeof raw === "object" ? raw : {}) as { type?: string; delta?: string; content?: string };
        const kind = ev.type ?? "";
        if (kind === "text_delta" && typeof ev.delta === "string") {
          this.emit({ type: "message_delta", sessionId, role: "assistant", text: ev.delta });
        }
        break;
      }
      case "tool_execution_start":
        this.emit({
          type: "tool_start",
          sessionId,
          toolCallId: String(event.toolCallId ?? ""),
          toolName: String(event.toolName ?? ""),
          args: event.args,
        });
        break;
      case "tool_execution_end":
        this.emit({
          type: "tool_end",
          sessionId,
          toolCallId: String(event.toolCallId ?? ""),
          toolName: String(event.toolName ?? ""),
          result: event.result,
          isError: Boolean(event.isError),
        });
        break;
      case "error":
        this.emit({ type: "error", sessionId, code: "pi_event_error", message: String(event.error ?? "unknown") });
        break;
      case "extension_ui_request": {
        // Approval bridge: the injected extension asks the user to confirm a
        // tool call via ctx.ui.confirm → RPC extension_ui_request sub-protocol.
        const requestId = String(event.id ?? "");
        const method = String(event.method ?? "");
        if (method === "confirm") {
          const title = String(event.title ?? "Approve tool?");
          const message = String(event.message ?? "");
          this.pendingApprovals.set(requestId, {
            requestId,
            sessionId,
            toolName: toolNameFromApprovalMessage(message),
            title,
            message,
            createdAt: Date.now(),
          });
          this.emit({
            type: "permission_request",
            sessionId,
            requestId,
            permission: {
              kind: "tool_approval",
              title,
              message,
            },
          });
        }
        break;
      }
      default:
        break;
    }
  }

  private emit(event: EngineEvent) {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        // listener errors are non-fatal
      }
    }
  }

  onEvent(cb: EngineEventCallback): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── sessions ───────────────────────────────────────────────

  async createSession(input: {
    title?: string;
    directory?: string;
    agentId?: string;
    model?: { providerID: string; modelID: string };
  }): Promise<SessionRef> {
    if (this.pool.size >= MAX_CONCURRENT) {
      const oldest = [...this.pool.entries()].sort((a, b) => a[1].idleSince - b[1].idleSince)[0];
      if (oldest) await this.disposeSession(oldest[0]);
    }
    const proc = await this.spawnSession("new");
    const resp = await proc.send({ type: "new_session" });
    if (!resp.success) {
      await proc.stop();
      this.pool.delete("new");
      throw new Error(`pi new_session failed: ${resp.error ?? "unknown"}`);
    }
    if (input.title) {
      await proc.send({ type: "set_session_name", name: input.title });
    }
    const state = await proc.send({ type: "get_state" });
    const data = state.data as { sessionId?: string; sessionFile?: string } | undefined;
    const sessionId = String(data?.sessionId ?? "");
    if (!sessionId) {
      await proc.stop();
      this.pool.delete("new");
      throw new Error("pi new_session returned no session id");
    }
    // Re-key the pool entry from "new" to the real session id.
    const entry = this.pool.get("new");
    if (entry) {
      entry.sessionFile = data?.sessionFile ?? null;
      entry.idleSince = Date.now();
      entry.sessionKeyRef.current = sessionId;
      this.pool.delete("new");
      this.pool.set(sessionId, entry);
    }
    return { id: sessionId, engine: "pi" };
  }

  async listSessions(): Promise<SessionSummary[]> {
    return listPiSessions(this.managedDir);
  }

  async getSession(id: string): Promise<SessionDetail> {
    const fileName = await findSessionFile(this.managedDir, id);
    return {
      id,
      engine: "pi",
      ...(fileName ? { title: fileName } : {}),
    };
  }

  async deleteSession(id: string): Promise<void> {
    const entry = this.pool.get(id);
    if (entry) {
      await entry.process.stop();
      this.pool.delete(id);
    }
    await deletePiSessionFile(this.managedDir, id);
  }

  async sendMessage(
    sessionId: string,
    input: { prompt: string; tools?: string[]; model?: { providerID: string; modelID: string } },
  ): Promise<void> {
    // Live process (recently created session): prompt directly.
    // Otherwise restore the persisted session file first so the prompt
    // continues the conversation instead of starting a new empty session.
    const entry = this.pool.get(sessionId);
    const proc =
      entry && entry.process.isRunning()
        ? (entry.idleSince = Date.now(), entry.process)
        : await this.acquireForRead(sessionId);
    const resp = await proc.send({ type: "prompt", message: input.prompt }, 30_000);
    if (!resp.success) {
      throw new Error(`pi prompt failed: ${resp.error ?? "unknown"}`);
    }
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.pool.get(sessionId);
    if (entry && entry.process.isRunning()) {
      await entry.process.send({ type: "abort" }, 5_000);
    }
  }

  async getMessages(sessionId: string): Promise<unknown[]> {
    const proc = await this.acquireForRead(sessionId);
    const resp = await proc.send({ type: "get_messages" }, 15_000);
    if (!resp.success) return [];
    const data = resp.data as { messages?: unknown[] } | undefined;
    return Array.isArray(data?.messages) ? data.messages : [];
  }

  async listModels(): Promise<ModelInfo[]> {
    // First release: host-side model list is mapped by the server layer
    // (capabilities.models === "mapped-from-host"); keep the RPC probe minimal.
    const proc = await this.spawnSession("models");
    try {
      const resp = await proc.send({ type: "get_available_models" }, 15_000);
      if (!resp.success) return [];
      const data = resp.data as { models?: Array<{ id?: string; name?: string; provider?: string }> } | undefined;
      return (data?.models ?? []).map((m) => ({
        id: String(m.id ?? ""),
        name: m.name ?? undefined,
        provider: m.provider ?? undefined,
      }));
    } finally {
      await proc.stop();
      this.pool.delete("models");
    }
  }

  async approvePermission(sessionId: string, requestId: string, allow: boolean): Promise<void> {
    const entry = this.pool.get(sessionId);
    if (!entry || !entry.process.isRunning()) {
      throw new Error(`Pi engine: no live process for session ${sessionId}`);
    }
    // Send the extension_ui_response back to the blocked ctx.ui.confirm() call.
    // allow=true → the extension returns undefined (tool runs);
    // allow=false → the extension returns {block:true} (tool does not execute).
    entry.process.sendExtensionUiResponse(requestId, {
      confirmed: allow,
      cancelled: false,
    });
    this.pendingApprovals.delete(requestId);
  }

  async listPermissions(sessionId?: string): Promise<unknown[]> {
    const items = [...this.pendingApprovals.values()];
    const filtered = sessionId
      ? items.filter((item) => item.sessionId === sessionId)
      : items;
    return filtered.map((item) => ({
      id: item.requestId,
      sessionID: item.sessionId,
      permission: {
        kind: "tool_approval",
        toolName: item.toolName,
        title: item.title,
        message: item.message,
      },
      createdAt: item.createdAt,
    }));
  }
}
