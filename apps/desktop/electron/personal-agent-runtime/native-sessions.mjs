import { createHash } from "node:crypto";
import { open, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function isStaleNativeSessionError(provider, error) {
  if (String(provider ?? "") !== "claude") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /No conversation found with session ID/i.test(message);
}

export function staleNativeSessionResetMessage(provider) {
  return `${String(provider ?? "provider")} native session was missing; starting a fresh provider session for this Studio conversation.`;
}

export function createPersonalAgentNativeSessionBridge(options = {}) {
  const detectPersonalLocalAgent = options.detectPersonalLocalAgent;
  const runCommandCapture = options.runCommandCapture;
  const claudeProjectsRoot = options.claudeProjectsRoot ?? (() => path.join(os.homedir(), ".claude", "projects"));
  if (typeof detectPersonalLocalAgent !== "function") throw new Error("detectPersonalLocalAgent is required");
  if (typeof runCommandCapture !== "function") throw new Error("runCommandCapture is required");

  function nativeSessionItem(input) {
    const id = String(input?.id ?? input?.sessionId ?? input?.threadId ?? "").trim();
    if (!id) return null;
    const title = String(input?.title ?? input?.name ?? input?.preview ?? input?.threadName ?? id).trim() || id;
    const updatedAt = Number(input?.updatedAt ?? input?.updated ?? input?.lastActiveAt ?? 0) || Date.now();
    return {
      id,
      title,
      providerSessionId: id,
      resumeKey: String(input?.resumeKey ?? id).trim() || id,
      workdir: String(input?.workdir ?? input?.directory ?? "").trim() || null,
      updatedAt,
      source: String(input?.source ?? "provider-native").trim() || "provider-native",
      metadata: input?.metadata && typeof input.metadata === "object" ? input.metadata : null,
    };
  }

  function uniqueNativeSessions(items) {
    const seen = new Set();
    return items
      .map(nativeSessionItem)
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function listCodexNativeSessions(limit) {
    const indexPath = path.join(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "session_index.jsonl");
    let raw = "";
    try {
      raw = await readFile(indexPath, "utf8");
    } catch {
      return [];
    }
    const items = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        items.push({
          id: parsed.id,
          title: parsed.thread_name,
          updatedAt: parsed.updated_at ? Date.parse(parsed.updated_at) : 0,
          source: "codex-session-index",
          metadata: { threadName: parsed.thread_name ?? null },
        });
      } catch {
        // Ignore corrupt index lines; the provider can rewrite this file.
      }
    }
    return uniqueNativeSessions(items).slice(0, limit);
  }

  function transcriptMessage(input) {
    const role = input?.role === "assistant" ? "assistant" : input?.role === "user" ? "user" : null;
    const text = String(input?.text ?? "").trim();
    if (!role || !text) return null;
    const createdAt = Number(input?.createdAt ?? input?.timestamp ?? 0) || Date.now();
    return {
      id: String(input?.id ?? `${role}-${createdAt}-${createHash("sha1").update(text).digest("hex").slice(0, 8)}`),
      role,
      text,
      createdAt,
    };
  }

  function uniqueTranscriptMessages(items, limit) {
    const seen = new Set();
    const normalized = [];
    for (const item of items) {
      const message = transcriptMessage(item);
      if (!message) continue;
      const key = `${message.role}:${message.createdAt}:${message.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(message);
    }
    return normalized.sort((a, b) => a.createdAt - b.createdAt).slice(-limit);
  }

  async function findCodexSessionFile(sessionId) {
    const id = String(sessionId ?? "").trim();
    if (!id) return null;
    const root = path.join(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "sessions");
    const found = [];
    async function walk(dir, depth) {
      if (depth > 6 || found.length) return;
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
          if (found.length) return;
        } else if (entry.isFile() && entry.name.endsWith(`${id}.jsonl`)) {
          found.push(fullPath);
          return;
        }
      }
    }
    await walk(root, 0);
    return found[0] ?? null;
  }

  function codexPayloadText(content) {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => {
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.message === "string") return part.message;
        return "";
      })
      .filter((part) => part.trim())
      .join("\n")
      .trim();
  }

  async function loadCodexTranscript(sessionId, limit) {
    const filePath = await findCodexSessionFile(sessionId);
    if (!filePath) return { messages: [], source: null, error: "Codex session transcript file was not found." };
    let raw = "";
    try {
      const fileStat = await stat(filePath).catch(() => null);
      raw = await readClaudeSessionSample(filePath, fileStat?.size ?? 0, 1_200_000);
    } catch (error) {
      return { messages: [], source: filePath, error: error instanceof Error ? error.message : String(error) };
    }
    const messages = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const timestamp = parsed.timestamp ? Date.parse(parsed.timestamp) : 0;
      if (parsed.type === "event_msg" && parsed.payload?.type === "user_message") {
        messages.push({ role: "user", text: parsed.payload.message, createdAt: timestamp });
      } else if (parsed.type === "event_msg" && parsed.payload?.type === "agent_message") {
        messages.push({ role: "assistant", text: parsed.payload.message, createdAt: timestamp });
      }
    }
    return { messages: uniqueTranscriptMessages(messages, limit), source: filePath, error: null };
  }

  async function collectClaudeSessionFiles(maxFiles = 300) {
    const root = claudeProjectsRoot();
    const found = [];
    async function walk(dir, depth) {
      if (depth > 4 || found.length > maxFiles * 4) return;
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (fullPath.includes(`${path.sep}subagents${path.sep}`)) continue;
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const fileStat = await stat(fullPath).catch(() => null);
        found.push({ path: fullPath, mtimeMs: fileStat?.mtimeMs ?? 0, size: fileStat?.size ?? 0 });
      }
    }
    await walk(root, 0);
    return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxFiles);
  }

  async function readClaudeSessionSample(filePath, size, maxBytes = 768_000) {
    const fileSize = Number(size) || 0;
    if (fileSize <= maxBytes) return readFile(filePath, "utf8");
    const half = Math.floor(maxBytes / 2);
    const handle = await open(filePath, "r");
    try {
      const head = Buffer.alloc(half);
      const tail = Buffer.alloc(half);
      const headRead = await handle.read(head, 0, half, 0);
      const tailRead = await handle.read(tail, 0, half, Math.max(0, fileSize - half));
      return `${head.subarray(0, headRead.bytesRead).toString("utf8")}\n${tail.subarray(0, tailRead.bytesRead).toString("utf8")}`;
    } finally {
      await handle.close();
    }
  }

  function claudeContentText(content) {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => (part?.type === "text" && typeof part?.text === "string" ? part.text : ""))
      .filter((part) => part.trim())
      .join("\n")
      .trim();
  }

  function parseClaudeSessionFile(raw, filePath, mtimeMs) {
    let sessionId = path.basename(filePath, ".jsonl");
    let title = "";
    let cwd = "";
    let version = "";
    let entrypoint = "";
    let updatedAt = Number(mtimeMs) || Date.now();
    for (const line of String(raw ?? "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed.sessionId) sessionId = String(parsed.sessionId);
      if (parsed.cwd) cwd = String(parsed.cwd);
      if (parsed.version) version = String(parsed.version);
      if (parsed.entrypoint) entrypoint = String(parsed.entrypoint);
      if (parsed.timestamp) {
        const parsedTime = Date.parse(parsed.timestamp);
        if (Number.isFinite(parsedTime)) updatedAt = Math.max(updatedAt, parsedTime);
      }
      if (parsed.type === "last-prompt" && parsed.lastPrompt) {
        title = String(parsed.lastPrompt).trim();
        continue;
      }
      if (!title && parsed.type === "user") title = claudeContentText(parsed.message?.content);
      if (!title && parsed.type === "assistant") title = claudeContentText(parsed.message?.content);
    }
    return nativeSessionItem({
      id: sessionId,
      title: title || sessionId,
      updatedAt,
      workdir: cwd,
      source: "claude-jsonl",
      metadata: { path: filePath, cwd: cwd || null, version: version || null, entrypoint: entrypoint || null },
    });
  }

  async function loadClaudeTranscript(sessionId, limit) {
    const id = String(sessionId ?? "").trim();
    if (!id) return { messages: [], source: null, error: "Claude session id is empty." };
    const files = await collectClaudeSessionFiles(800);
    const file = files.find((item) => path.basename(item.path, ".jsonl") === id);
    if (!file) return { messages: [], source: null, error: "Claude session transcript file was not found." };
    let raw = "";
    try {
      raw = await readClaudeSessionSample(file.path, file.size, 1_200_000);
    } catch (error) {
      return { messages: [], source: file.path, error: error instanceof Error ? error.message : String(error) };
    }
    const messages = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const timestamp = parsed.timestamp ? Date.parse(parsed.timestamp) : file.mtimeMs;
      if (parsed.type === "user") {
        messages.push({ role: "user", text: claudeContentText(parsed.message?.content), createdAt: timestamp, id: parsed.uuid });
      } else if (parsed.type === "assistant") {
        messages.push({ role: "assistant", text: claudeContentText(parsed.message?.content), createdAt: timestamp, id: parsed.uuid });
      }
    }
    return { messages: uniqueTranscriptMessages(messages, limit), source: file.path, error: null };
  }

  async function listClaudeNativeSessions(limit) {
    const files = await collectClaudeSessionFiles(Math.max(200, limit * 4));
    const items = [];
    for (const file of files) {
      let raw = "";
      try {
        raw = await readClaudeSessionSample(file.path, file.size);
      } catch {
        continue;
      }
      const item = parseClaudeSessionFile(raw, file.path, file.mtimeMs);
      if (item) items.push(item);
      if (items.length >= limit * 2) break;
    }
    return uniqueNativeSessions(items).slice(0, limit);
  }

  function parseHermesSessionTable(stdout) {
    const items = [];
    for (const line of String(stdout ?? "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^Preview\s+Last Active\s+Src\s+ID$/.test(trimmed) || /^─+$/.test(trimmed)) continue;
      const match = trimmed.match(/^(.+?)\s{2,}(\S.*?ago|now|\S+)\s{2,}(\S+)\s{2,}([A-Za-z0-9_-]+)$/);
      if (!match) continue;
      items.push({
        id: match[4],
        title: match[1].trim(),
        updatedAt: Date.now(),
        source: `hermes-${match[3]}`,
        metadata: { lastActive: match[2], source: match[3] },
      });
    }
    return uniqueNativeSessions(items);
  }

  async function listNativeSessions(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const limit = Math.min(100, Math.max(1, Number(input.limit ?? 50) || 50));
    const detected = await detectPersonalLocalAgent(input.agent ?? {}, workspaceRoot, { includeModels: false });
    if (detected.status !== "online") return { sessions: [], provider: detected.provider, error: detected.error };

    if (detected.provider === "opencode") {
      const result = await runCommandCapture(detected.executablePath, ["session", "list", "--format", "json", "-n", String(limit)], { timeoutMs: 8000, cwd: workspaceRoot || undefined });
      if (!result.ok) return { sessions: [], provider: detected.provider, error: (result.stderr || result.stdout).trim() };
      try {
        const parsed = JSON.parse(result.stdout.trim() || "[]");
        const sessions = uniqueNativeSessions((Array.isArray(parsed) ? parsed : []).map((item) => ({
          id: item.id,
          title: item.title,
          updatedAt: item.updated,
          workdir: item.directory,
          source: "opencode-session-list",
          metadata: { projectId: item.projectId ?? null, created: item.created ?? null },
        }))).slice(0, limit);
        return { sessions, provider: detected.provider };
      } catch (error) {
        return { sessions: [], provider: detected.provider, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (detected.provider === "openclaw") {
      const args = ["sessions", "--json", "--limit", String(limit)];
      if (detected.model) args.push("--agent", detected.model);
      const result = await runCommandCapture(detected.executablePath, args, { timeoutMs: 8000, cwd: workspaceRoot || undefined });
      if (!result.ok) return { sessions: [], provider: detected.provider, error: (result.stderr || result.stdout).trim() };
      try {
        const parsed = JSON.parse(result.stdout.trim() || "{}");
        const sessions = uniqueNativeSessions((Array.isArray(parsed?.sessions) ? parsed.sessions : []).map((item) => ({
          id: item.sessionId,
          title: `${item.agentId ?? "agent"} · ${item.modelProvider ?? "provider"}/${item.model ?? "model"}`,
          updatedAt: item.updatedAt,
          resumeKey: item.sessionId,
          source: "openclaw-sessions-json",
          metadata: { key: item.key ?? null, agentId: item.agentId ?? null, totalTokens: item.totalTokens ?? null },
        }))).slice(0, limit);
        return { sessions, provider: detected.provider };
      } catch (error) {
        return { sessions: [], provider: detected.provider, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (detected.provider === "codex") {
      return { sessions: await listCodexNativeSessions(limit), provider: detected.provider };
    }

    if (detected.provider === "claude") {
      return { sessions: await listClaudeNativeSessions(limit), provider: detected.provider };
    }

    if (detected.provider === "hermes") {
      const result = await runCommandCapture(detected.executablePath, ["sessions", "list", "--limit", String(limit)], { timeoutMs: 8000, cwd: workspaceRoot || undefined });
      if (!result.ok) return { sessions: [], provider: detected.provider, error: (result.stderr || result.stdout).trim() };
      return { sessions: parseHermesSessionTable(result.stdout).slice(0, limit), provider: detected.provider };
    }

    return { sessions: [], provider: detected.provider, error: "This provider does not expose a stable native session list." };
  }

  function opencodePartText(part) {
    if (typeof part?.text === "string") return part.text;
    if (typeof part?.content === "string") return part.content;
    if (typeof part?.message === "string") return part.message;
    return "";
  }

  async function loadOpenCodeTranscript(agent, workspaceRoot, sessionId, limit) {
    const id = String(sessionId ?? "").trim();
    if (!id) return { messages: [], source: null, error: "OpenCode session id is empty." };
    const result = await runCommandCapture(agent.executablePath, ["export", id], { timeoutMs: 8000, cwd: workspaceRoot || undefined });
    if (!result.ok) return { messages: [], source: "opencode export", error: (result.stderr || result.stdout).trim() };
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout.trim() || "{}");
    } catch (error) {
      return { messages: [], source: "opencode export", error: error instanceof Error ? error.message : String(error) };
    }
    const messages = [];
    for (const item of Array.isArray(parsed?.messages) ? parsed.messages : []) {
      const role = item?.info?.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = Array.isArray(item.parts)
        ? item.parts.map(opencodePartText).filter((part) => part.trim()).join("\n").trim()
        : "";
      if (!text && role === "assistant" && item?.info?.error?.data?.message) {
        messages.push({ role, text: String(item.info.error.data.message), createdAt: item?.info?.time?.completed ?? item?.info?.time?.created, id: item?.info?.id });
        continue;
      }
      messages.push({ role, text, createdAt: item?.info?.time?.created ?? item?.info?.time?.completed, id: item?.info?.id });
    }
    return { messages: uniqueTranscriptMessages(messages, limit), source: "opencode export", error: null };
  }

  async function loadConversationTranscript(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const limit = Math.min(100, Math.max(1, Number(input.limit ?? 50) || 50));
    const detected = await detectPersonalLocalAgent(input.agent ?? {}, workspaceRoot, { includeModels: false });
    const providerSessionId = String(input.providerSessionId ?? input.resumeKey ?? "").trim();
    if (detected.status !== "online") return { provider: detected.provider, conversationId: String(input.conversationId ?? "") || null, messages: [], source: null, error: detected.error };
    let result = { messages: [], source: null, error: "This provider does not expose a stable native transcript." };
    if (detected.provider === "claude") {
      result = await loadClaudeTranscript(providerSessionId, limit);
    } else if (detected.provider === "codex") {
      result = await loadCodexTranscript(providerSessionId, limit);
    } else if (detected.provider === "opencode") {
      result = await loadOpenCodeTranscript(detected, workspaceRoot, providerSessionId, limit);
    }
    return {
      provider: detected.provider,
      conversationId: String(input.conversationId ?? "") || null,
      messages: result.messages,
      source: result.source,
      error: result.error,
    };
  }

  return { listNativeSessions, loadConversationTranscript };
}
