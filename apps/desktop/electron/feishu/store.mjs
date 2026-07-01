import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { FEISHU_BASE_URL } from "./client.mjs";

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

export function createFeishuStore(rootDir) {
  const root = path.join(rootDir, "feishu");
  const accountRoot = path.join(root, "accounts");
  const configPath = path.join(root, "config.json");

  function accountFile(accountId) {
    const id = safeAccountId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.json`);
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
    const appId = String(input.appId ?? input.app_id ?? input.accountId ?? input.account_id ?? "").trim();
    const appSecret = String(input.appSecret ?? input.app_secret ?? "").trim();
    if (!appId) throw new Error("appId is required");
    if (!appSecret) throw new Error("appSecret is required");
    const payload = {
      accountId: appId,
      appId,
      appSecret,
      baseUrl: String(input.baseUrl ?? input.base_url ?? FEISHU_BASE_URL).trim().replace(/\/+$/, "") || FEISHU_BASE_URL,
      verificationToken: String(input.verificationToken ?? input.verification_token ?? "").trim(),
      encryptKey: String(input.encryptKey ?? input.encrypt_key ?? "").trim(),
      savedAt: new Date().toISOString(),
    };
    await writeJsonFile(accountFile(appId), payload);
    await writeConfig({ ...(await readConfig()), defaultAccountId: appId, updatedAt: Date.now() });
    return sanitizeAccount(payload);
  }

  async function loadAccount(accountId) {
    const raw = await readJsonFile(accountFile(accountId));
    if (!raw || typeof raw !== "object") return null;
    const appId = String(raw.appId ?? raw.app_id ?? raw.accountId ?? raw.account_id ?? accountId).trim();
    return {
      accountId: appId,
      appId,
      appSecret: String(raw.appSecret ?? raw.app_secret ?? "").trim(),
      baseUrl: String(raw.baseUrl ?? raw.base_url ?? FEISHU_BASE_URL).trim().replace(/\/+$/, "") || FEISHU_BASE_URL,
      verificationToken: String(raw.verificationToken ?? raw.verification_token ?? "").trim(),
      encryptKey: String(raw.encryptKey ?? raw.encrypt_key ?? "").trim(),
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
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".chat-settings.json") || entry.name.endsWith(".chat-history.json") || entry.name.endsWith(".active-runs.json")) continue;
      const account = await loadAccount(entry.name.slice(0, -".json".length)).catch(() => null);
      if (account?.accountId && account.appSecret) accounts.push(account);
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
      if (account?.appSecret) return account;
    }
    return (await listAccounts())[0] ?? null;
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
  const secret = String(account.appSecret ?? "");
  const verificationToken = String(account.verificationToken ?? "");
  const encryptKey = String(account.encryptKey ?? "");
  return {
    accountId: String(account.accountId ?? ""),
    appId: String(account.appId ?? account.accountId ?? ""),
    baseUrl: String(account.baseUrl ?? FEISHU_BASE_URL),
    savedAt: account.savedAt ?? null,
    hasAppSecret: Boolean(secret),
    appSecretPreview: secret ? `${secret.slice(0, 4)}...${secret.slice(-4)}` : "",
    hasVerificationToken: Boolean(verificationToken),
    hasEncryptKey: Boolean(encryptKey),
  };
}

export const __test__ = {
  safeAccountId,
  readJsonFile,
};
