import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ILINK_BASE_URL, WEIXIN_CDN_BASE_URL } from "./ilink-client.mjs";

function safeAccountId(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.@-]/g, "_");
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value, mode = 0o600) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  await rename(tmp, filePath);
}

export function createWeixinStore(rootDir) {
  const root = path.join(rootDir, "weixin");
  const accountRoot = path.join(root, "accounts");
  const configPath = path.join(root, "config.json");

  function accountFile(accountId) {
    const id = safeAccountId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.json`);
  }

  function syncFile(accountId) {
    const id = safeAccountId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.sync.json`);
  }

  function contextFile(accountId) {
    const id = safeAccountId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.context-tokens.json`);
  }

  function chatSettingsFile(accountId) {
    const id = safeAccountId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.chat-settings.json`);
  }

  function chatHistoryFile(accountId) {
    const id = safeAccountId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.chat-history.json`);
  }

  function activeRunsFile(accountId) {
    const id = safeAccountId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.active-runs.json`);
  }

  async function saveAccount(input = {}) {
    const accountId = String(input.accountId ?? input.account_id ?? "").trim();
    const token = String(input.token ?? "").trim();
    if (!accountId) throw new Error("accountId is required");
    if (!token) throw new Error("token is required");
    const payload = {
      accountId,
      token,
      baseUrl: String(input.baseUrl ?? input.base_url ?? ILINK_BASE_URL).trim().replace(/\/+$/, "") || ILINK_BASE_URL,
      cdnBaseUrl: String(input.cdnBaseUrl ?? input.cdn_base_url ?? WEIXIN_CDN_BASE_URL).trim().replace(/\/+$/, "") || WEIXIN_CDN_BASE_URL,
      userId: String(input.userId ?? input.user_id ?? "").trim(),
      savedAt: new Date().toISOString(),
    };
    await writeJsonFile(accountFile(accountId), payload);
    await writeConfig({ ...(await readConfig()), defaultAccountId: accountId, updatedAt: Date.now() });
    return sanitizeAccount(payload);
  }

  async function loadAccount(accountId) {
    const raw = await readJsonFile(accountFile(accountId));
    if (!raw || typeof raw !== "object") return null;
    return {
      accountId: String(raw.accountId ?? raw.account_id ?? accountId).trim(),
      token: String(raw.token ?? "").trim(),
      baseUrl: String(raw.baseUrl ?? raw.base_url ?? ILINK_BASE_URL).trim().replace(/\/+$/, "") || ILINK_BASE_URL,
      cdnBaseUrl: String(raw.cdnBaseUrl ?? raw.cdn_base_url ?? WEIXIN_CDN_BASE_URL).trim().replace(/\/+$/, "") || WEIXIN_CDN_BASE_URL,
      userId: String(raw.userId ?? raw.user_id ?? "").trim(),
      savedAt: raw.savedAt ?? raw.saved_at ?? null,
    };
  }

  async function listAccounts() {
    let entries = [];
    try {
      entries = await readdir(accountRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const accounts = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".sync.json") || entry.name.endsWith(".context-tokens.json") || entry.name.endsWith(".chat-settings.json") || entry.name.endsWith(".chat-history.json") || entry.name.endsWith(".active-runs.json")) continue;
      const account = await loadAccount(entry.name.slice(0, -".json".length)).catch(() => null);
      if (account?.accountId && account.token) accounts.push(account);
    }
    return accounts.sort((a, b) => Date.parse(b.savedAt ?? "") - Date.parse(a.savedAt ?? ""));
  }

  async function readConfig() {
    const raw = await readJsonFile(configPath, {});
    return raw && typeof raw === "object" ? raw : {};
  }

  async function writeConfig(value = {}) {
    const prior = await readConfig();
    await writeJsonFile(configPath, { ...prior, ...value, updatedAt: Date.now() });
  }

  async function loadDefaultAccount() {
    const config = await readConfig();
    const configured = String(config.defaultAccountId ?? "").trim();
    if (configured) {
      const account = await loadAccount(configured).catch(() => null);
      if (account?.token) return account;
    }
    return (await listAccounts())[0] ?? null;
  }

  async function readSyncBuf(accountId) {
    const raw = await readJsonFile(syncFile(accountId), {});
    return String(raw?.get_updates_buf ?? raw?.syncBuf ?? "");
  }

  async function writeSyncBuf(accountId, syncBuf) {
    await writeJsonFile(syncFile(accountId), { get_updates_buf: String(syncBuf ?? "") });
  }

  async function readContextTokens(accountId) {
    const raw = await readJsonFile(contextFile(accountId), {});
    return raw && typeof raw === "object" ? raw : {};
  }

  async function writeContextToken(accountId, peerId, token) {
    const peer = String(peerId ?? "").trim();
    if (!peer || !token) return;
    const raw = await readContextTokens(accountId);
    raw[peer] = { contextToken: String(token), updatedAt: Date.now() };
    await writeJsonFile(contextFile(accountId), raw);
  }

  async function readContextToken(accountId, peerId) {
    const raw = await readContextTokens(accountId);
    const entry = raw[String(peerId ?? "").trim()];
    return String(entry?.contextToken ?? entry ?? "").trim();
  }

  async function readChatSettings(accountId) {
    const raw = await readJsonFile(chatSettingsFile(accountId), {});
    return raw && typeof raw === "object" ? raw : {};
  }

  async function readChatSetting(accountId, chatId) {
    const chat = String(chatId ?? "").trim();
    if (!chat) return null;
    const raw = await readChatSettings(accountId);
    const entry = raw[chat];
    return entry && typeof entry === "object" ? entry : null;
  }

  async function writeChatSetting(accountId, chatId, patch = {}) {
    const chat = String(chatId ?? "").trim();
    if (!chat) return null;
    const raw = await readChatSettings(accountId);
    const prior = raw[chat] && typeof raw[chat] === "object" ? raw[chat] : {};
    const next = { ...prior, ...patch, updatedAt: Date.now() };
    raw[chat] = next;
    await writeJsonFile(chatSettingsFile(accountId), raw);
    return next;
  }

  async function readChatHistory(accountId, chatId, limit = 12) {
    const chat = String(chatId ?? "").trim();
    if (!chat) return [];
    const raw = await readJsonFile(chatHistoryFile(accountId), {});
    const items = raw && typeof raw === "object" && Array.isArray(raw[chat]) ? raw[chat] : [];
    const max = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : 12;
    return items.slice(-max);
  }

  async function appendChatHistory(accountId, chatId, entries = [], limit = 24) {
    const chat = String(chatId ?? "").trim();
    if (!chat) return [];
    const raw = await readJsonFile(chatHistoryFile(accountId), {});
    const current = raw && typeof raw === "object" && Array.isArray(raw[chat]) ? raw[chat] : [];
    const now = Date.now();
    const nextEntries = (Array.isArray(entries) ? entries : [entries]).map((entry) => ({
      role: String(entry?.role ?? "user"),
      text: String(entry?.text ?? ""),
      at: Number.isFinite(Number(entry?.at)) ? Number(entry.at) : now,
      agentId: entry?.agentId ? String(entry.agentId) : undefined,
      agentProvider: entry?.agentProvider ? String(entry.agentProvider) : undefined,
    })).filter((entry) => entry.text.trim());
    const max = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 24;
    raw[chat] = [...current, ...nextEntries].slice(-max);
    await writeJsonFile(chatHistoryFile(accountId), raw);
    return raw[chat];
  }

  async function clearChatHistory(accountId, chatId) {
    const chat = String(chatId ?? "").trim();
    if (!chat) return false;
    const raw = await readJsonFile(chatHistoryFile(accountId), {});
    if (!raw || typeof raw !== "object" || !Array.isArray(raw[chat])) return false;
    delete raw[chat];
    await writeJsonFile(chatHistoryFile(accountId), raw);
    return true;
  }

  async function readActiveRuns(accountId) {
    const raw = await readJsonFile(activeRunsFile(accountId), {});
    return raw && typeof raw === "object" ? raw : {};
  }

  async function listActiveRuns(accountId) {
    return Object.values(await readActiveRuns(accountId)).filter((entry) => entry && typeof entry === "object");
  }

  async function readActiveRun(accountId, runKey) {
    const key = String(runKey ?? "").trim();
    if (!key) return null;
    const raw = await readActiveRuns(accountId);
    const entry = raw[key];
    return entry && typeof entry === "object" ? entry : null;
  }

  async function writeActiveRun(accountId, runKey, value = {}) {
    const key = String(runKey ?? "").trim();
    if (!key) return null;
    const raw = await readActiveRuns(accountId);
    const prior = raw[key] && typeof raw[key] === "object" ? raw[key] : {};
    const now = Date.now();
    const next = { ...prior, ...value, runKey: key, accountId: String(accountId), updatedAt: now, createdAt: prior.createdAt ?? value.createdAt ?? now };
    raw[key] = next;
    await writeJsonFile(activeRunsFile(accountId), raw);
    return next;
  }

  async function deleteActiveRun(accountId, runKey) {
    const key = String(runKey ?? "").trim();
    if (!key) return false;
    const raw = await readActiveRuns(accountId);
    if (!Object.hasOwn(raw, key)) return false;
    delete raw[key];
    await writeJsonFile(activeRunsFile(accountId), raw);
    return true;
  }

  return {
    root,
    accountRoot,
    saveAccount,
    loadAccount,
    listAccounts,
    loadDefaultAccount,
    readConfig,
    writeConfig,
    readSyncBuf,
    writeSyncBuf,
    readContextToken,
    writeContextToken,
    readChatSetting,
    writeChatSetting,
    readChatHistory,
    appendChatHistory,
    clearChatHistory,
    readActiveRuns,
    listActiveRuns,
    readActiveRun,
    writeActiveRun,
    deleteActiveRun,
  };
}

export function sanitizeAccount(account) {
  if (!account) return null;
  const token = String(account.token ?? "");
  return {
    accountId: String(account.accountId ?? ""),
    baseUrl: String(account.baseUrl ?? ILINK_BASE_URL),
    cdnBaseUrl: String(account.cdnBaseUrl ?? WEIXIN_CDN_BASE_URL),
    userId: String(account.userId ?? ""),
    savedAt: account.savedAt ?? null,
    hasToken: Boolean(token),
    tokenPreview: token ? `${token.slice(0, 6)}...${token.slice(-4)}` : "",
  };
}

export const __test__ = {
  safeAccountId,
  readJsonFile,
};
