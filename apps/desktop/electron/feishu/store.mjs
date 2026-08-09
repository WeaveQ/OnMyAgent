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
  const activeRunMutationQueues = new Map();
  const chatHistoryMutationQueues = new Map();
  const chatSettingsMutationQueues = new Map();

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

  function enqueueFileMutation(queues, filePath, operation) {
    const prior = queues.get(filePath) ?? Promise.resolve();
    const task = prior.catch(() => undefined).then(operation);
    const barrier = task.catch(() => undefined);
    const tracked = barrier.finally(() => {
      if (queues.get(filePath) === tracked) queues.delete(filePath);
    });
    queues.set(filePath, tracked);
    return task;
  }

  function enqueueActiveRunMutation(accountId, operation) {
    return enqueueFileMutation(activeRunMutationQueues, activeRunsFile(accountId), operation);
  }

  async function waitForActiveRunMutations(accountId) {
    await activeRunMutationQueues.get(activeRunsFile(accountId))?.catch(() => undefined);
  }

  function enqueueChatHistoryMutation(accountId, operation) {
    return enqueueFileMutation(chatHistoryMutationQueues, chatHistoryFile(accountId), operation);
  }

  async function waitForChatHistoryMutations(accountId) {
    await chatHistoryMutationQueues.get(chatHistoryFile(accountId))?.catch(() => undefined);
  }

  function enqueueChatSettingsMutation(accountId, operation) {
    return enqueueFileMutation(chatSettingsMutationQueues, chatSettingsFile(accountId), operation);
  }

  async function waitForChatSettingsMutations(accountId) {
    await chatSettingsMutationQueues.get(chatSettingsFile(accountId))?.catch(() => undefined);
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
    await waitForChatSettingsMutations(accountId);
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
    return await enqueueChatSettingsMutation(accountId, async () => {
      const raw = await readJsonFile(chatSettingsFile(accountId), {});
      const settings = raw && typeof raw === "object" ? raw : {};
      const prior = settings[chat] && typeof settings[chat] === "object" ? settings[chat] : {};
      const next = { ...prior, ...patch, updatedAt: Date.now() };
      settings[chat] = next;
      await writeJsonFile(chatSettingsFile(accountId), settings);
      return next;
    });
  }

  async function readChatHistory(accountId, chatId, limit = 12) {
    const chat = String(chatId ?? "").trim();
    if (!chat) return [];
    await waitForChatHistoryMutations(accountId);
    const raw = await readJsonFile(chatHistoryFile(accountId), {});
    const items = raw && typeof raw === "object" && Array.isArray(raw[chat]) ? raw[chat] : [];
    const max = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : 12;
    return items.slice(-max);
  }

  async function appendChatHistory(accountId, chatId, entries = [], limit = 24) {
    const chat = String(chatId ?? "").trim();
    if (!chat) return [];
    return await enqueueChatHistoryMutation(accountId, async () => {
      const raw = await readJsonFile(chatHistoryFile(accountId), {});
      const histories = raw && typeof raw === "object" ? raw : {};
      const current = Array.isArray(histories[chat]) ? histories[chat] : [];
      const now = Date.now();
      const nextEntries = (Array.isArray(entries) ? entries : [entries]).map((entry) => ({
        role: String(entry?.role ?? "user"), text: String(entry?.text ?? ""),
        at: Number.isFinite(Number(entry?.at)) ? Number(entry.at) : now,
        agentId: entry?.agentId ? String(entry.agentId) : undefined,
        agentProvider: entry?.agentProvider ? String(entry.agentProvider) : undefined,
      })).filter((entry) => entry.text.trim());
      const max = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 24;
      histories[chat] = [...current, ...nextEntries].slice(-max);
      await writeJsonFile(chatHistoryFile(accountId), histories);
      return histories[chat];
    });
  }

  async function clearChatHistory(accountId, chatId) {
    const chat = String(chatId ?? "").trim();
    if (!chat) return false;
    return await enqueueChatHistoryMutation(accountId, async () => {
      const raw = await readJsonFile(chatHistoryFile(accountId), {});
      if (!raw || typeof raw !== "object" || !Array.isArray(raw[chat])) return false;
      delete raw[chat];
      await writeJsonFile(chatHistoryFile(accountId), raw);
      return true;
    });
  }

  async function readActiveRuns(accountId) {
    await waitForActiveRunMutations(accountId);
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
    return await enqueueActiveRunMutation(accountId, async () => {
      const raw = await readJsonFile(activeRunsFile(accountId), {});
      const runs = raw && typeof raw === "object" ? raw : {};
      const prior = runs[key] && typeof runs[key] === "object" ? runs[key] : {};
      const now = Date.now();
      const next = { ...prior, ...value, runKey: key, accountId: String(accountId), updatedAt: now, createdAt: prior.createdAt ?? value.createdAt ?? now };
      runs[key] = next;
      await writeJsonFile(activeRunsFile(accountId), runs);
      return next;
    });
  }

  async function deleteActiveRun(accountId, runKey) {
    const key = String(runKey ?? "").trim();
    if (!key) return false;
    return await enqueueActiveRunMutation(accountId, async () => {
      const raw = await readJsonFile(activeRunsFile(accountId), {});
      const runs = raw && typeof raw === "object" ? raw : {};
      if (!Object.hasOwn(runs, key)) return false;
      delete runs[key];
      await writeJsonFile(activeRunsFile(accountId), runs);
      return true;
    });
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
