/**
 * Shared JSON-backed store for messaging channel plugins.
 *
 * Telegram and Discord keep their credentials + run state on disk under the
 * Electron userData directory (never in the repo). This module provides the
 * exact interface the shared agent dispatcher (agent-dispatch.mjs) expects:
 * account persistence, service config, active-run tracking, per-chat history
 * and per-chat settings.
 *
 * Each platform wraps this with its own directory (telegram/ / discord/).
 */

import { mkdir, readFile, readdir, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function safeId(value) {
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

export function createChannelStore(options = {}) {
  const rootDir = String(options.rootDir ?? "").trim();
  if (!rootDir) throw new Error("createChannelStore: rootDir is required");
  const platformDir = String(options.platformDir ?? "channel").trim();
  const root = path.join(rootDir, platformDir);
  const accountRoot = path.join(root, "accounts");
  const configPath = path.join(root, "config.json");

  function accountFile(accountId) {
    const id = safeId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.json`);
  }
  function chatSettingsFile(accountId) {
    const id = safeId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.chat-settings.json`);
  }
  function chatHistoryFile(accountId) {
    const id = safeId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.chat-history.json`);
  }
  function activeRunsFile(accountId) {
    const id = safeId(accountId);
    if (!id) throw new Error("accountId is required");
    return path.join(accountRoot, `${id}.active-runs.json`);
  }

  async function saveAccount(input = {}) {
    const accountId = String(input.accountId ?? input.account_id ?? input.botUsername ?? input.username ?? "").trim();
    const token = String(input.token ?? "").trim();
    if (!accountId) throw new Error("accountId is required");
    if (!token) throw new Error("token is required");
    const payload = {
      accountId,
      token,
      botUsername: String(input.botUsername ?? input.username ?? "").trim() || undefined,
      username: String(input.username ?? input.botUsername ?? "").trim() || undefined,
      allowedUserIds: Array.isArray(input.allowedUserIds)
        ? input.allowedUserIds.map(String)
        : (input.allowedUserIds ? String(input.allowedUserIds).split(",").map((s) => s.trim()).filter(Boolean) : undefined),
      homeChannelId: String(input.homeChannelId ?? "").trim() || undefined,
    };
    await writeJsonFile(accountFile(accountId), payload);
    // Make this the default account for auto-start convenience.
    const config = (await readJsonFile(configPath, {})) ?? {};
    config.defaultAccountId = accountId;
    await writeJsonFile(configPath, config);
    return payload;
  }

  async function loadAccount(accountId) {
    const id = String(accountId ?? "").trim();
    if (!id) return null;
    const data = await readJsonFile(accountFile(id), null);
    if (!data || !data.token) return null;
    return data;
  }

  async function loadDefaultAccount() {
    const config = (await readJsonFile(configPath, {})) ?? {};
    const defaultId = String(config.defaultAccountId ?? "").trim();
    if (defaultId) {
      const found = await loadAccount(defaultId);
      if (found) return found;
    }
    // Fall back to the first persisted account.
    try {
      const names = (await readdir(accountRoot)).filter((n) => n.endsWith(".json") && !n.includes(".chat-") && !n.includes(".active-runs"));
      for (const name of names) {
        const data = await readJsonFile(path.join(accountRoot, name), null);
        if (data?.token) return data;
      }
    } catch { /* no accounts yet */ }
    return null;
  }

  async function listAccounts() {
    try {
      const names = (await readdir(accountRoot)).filter((n) => n.endsWith(".json") && !n.includes(".chat-") && !n.includes(".active-runs"));
      const out = [];
      for (const name of names) {
        const data = await readJsonFile(path.join(accountRoot, name), null);
        if (data?.token) out.push(data);
      }
      return out;
    } catch {
      return [];
    }
  }

  async function readConfig() {
    return (await readJsonFile(configPath, {})) ?? {};
  }

  async function writeConfig(config) {
    const current = (await readJsonFile(configPath, {})) ?? {};
    const next = { ...current, ...config };
    await writeJsonFile(configPath, next);
    return next;
  }

  // --- active runs ---
  async function readActiveRun(accountId, runKey) {
    const all = (await readJsonFile(activeRunsFile(accountId), {})) ?? {};
    return all[runKey] ?? null;
  }
  async function writeActiveRun(accountId, runKey, record) {
    const all = (await readJsonFile(activeRunsFile(accountId), {})) ?? {};
    all[runKey] = record;
    await writeJsonFile(activeRunsFile(accountId), all);
    return record;
  }
  async function deleteActiveRun(accountId, runKey) {
    const all = (await readJsonFile(activeRunsFile(accountId), {})) ?? {};
    if (!(runKey in all)) return false;
    delete all[runKey];
    await writeJsonFile(activeRunsFile(accountId), all);
    return true;
  }
  async function listActiveRuns(accountId) {
    const all = (await readJsonFile(activeRunsFile(accountId), {})) ?? {};
    return Object.values(all);
  }

  // --- per-chat history ---
  async function readChatHistory(accountId, key, limit) {
    const all = (await readJsonFile(chatHistoryFile(accountId), {})) ?? {};
    const entries = Array.isArray(all[key]) ? all[key] : [];
    return limit ? entries.slice(-limit) : entries;
  }
  async function appendChatHistory(accountId, key, entries, limit = 100) {
    const all = (await readJsonFile(chatHistoryFile(accountId), {})) ?? {};
    const current = Array.isArray(all[key]) ? all[key] : [];
    const next = [...current, ...entries];
    all[key] = limit ? next.slice(-limit) : next;
    await writeJsonFile(chatHistoryFile(accountId), all);
    return all[key];
  }
  async function clearChatHistory(accountId, key) {
    const all = (await readJsonFile(chatHistoryFile(accountId), {})) ?? {};
    if (key in all) {
      delete all[key];
      await writeJsonFile(chatHistoryFile(accountId), all);
    }
    return true;
  }

  // --- per-chat settings ---
  async function readChatSetting(accountId, chatId) {
    const all = (await readJsonFile(chatSettingsFile(accountId), {})) ?? {};
    return all[chatId] ?? null;
  }
  async function writeChatSetting(accountId, chatId, setting) {
    const all = (await readJsonFile(chatSettingsFile(accountId), {})) ?? {};
    all[chatId] = { ...(all[chatId] ?? {}), ...setting };
    await writeJsonFile(chatSettingsFile(accountId), all);
    return all[chatId];
  }

  return {
    saveAccount,
    loadAccount,
    loadDefaultAccount,
    listAccounts,
    readConfig,
    writeConfig,
    readActiveRun,
    writeActiveRun,
    deleteActiveRun,
    listActiveRuns,
    readChatHistory,
    appendChatHistory,
    clearChatHistory,
    readChatSetting,
    writeChatSetting,
  };
}

export default createChannelStore;
