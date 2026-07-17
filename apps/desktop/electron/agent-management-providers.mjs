/**
 * Agent management providers — Studio Switch DB + live config sync for
 * opencode / claude / codex / hermes / openclaw.
 *
 * Composition root (main.mjs) wires createAgentManagementProviders and
 * exposes IPC handlers; this module owns pure provider read/write logic.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * @param {Partial<{ getRealHomeDir: () => string }>} options
 */
export function createAgentManagementProviders(options = {}) {
  const getRealHomeDir = options.getRealHomeDir;
  if (typeof getRealHomeDir !== "function") {
    throw new Error("createAgentManagementProviders requires getRealHomeDir");
  }

  function parseJsonLikeObject(raw) {
    const text = String(raw ?? "").replace(/^\uFEFF/, "");
    try {
      return JSON.parse(text);
    } catch {
      const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
      const withoutLineComments = withoutBlockComments.replace(/(^|[^:])\/\/.*$/gm, "$1");
      const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, "$1");
      try {
        return JSON.parse(withoutTrailingCommas);
      } catch {
        return null;
      }
    }
  }

  async function readJsonLikeFile(targetPath) {
    try {
      return parseJsonLikeObject(await readFile(targetPath, "utf8"));
    } catch {
      return null;
    }
  }

  async function writeJsonFileAtomic(outputPath, value) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    JSON.parse(content);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const tempPath = `${outputPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, outputPath);
  }

  const AGENT_MANAGEMENT_PROVIDER_APPS = ["opencode", "codex", "claude", "openclaw", "hermes"];
  const AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS = new Set(["opencode", "openclaw", "hermes"]);

  const AGENT_MANAGEMENT_PROVIDER_COLUMNS = [
    ["cost_multiplier", "TEXT NOT NULL DEFAULT '1.0'"],
    ["limit_daily_usd", "TEXT"],
    ["limit_monthly_usd", "TEXT"],
    ["provider_type", "TEXT"],
  ];

  function studioSwitchDatabasePath() {
    return path.join(getRealHomeDir(), ".studio-switch", "studio-switch.db");
  }

  function studioSwitchSkillsRoot() {
    return path.join(getRealHomeDir(), ".studio-switch", "skills");
  }

  function agentManagementConfigPath(appType) {
    const home = getRealHomeDir();
    switch (appType) {
      case "claude":
        return path.join(home, ".claude", "settings.json");
      case "codex":
        return path.join(home, ".codex", "config.toml");
      case "opencode":
        return path.join(home, ".config", "opencode", "opencode.json");
      case "openclaw":
        return path.join(home, ".openclaw", "openclaw.json");
      case "hermes":
        return path.join(home, ".hermes", "config.yaml");
      default:
        return "";
    }
  }

  function ensureStudioSwitchProviderSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      website_url TEXT,
      category TEXT,
      created_at INTEGER,
      sort_index INTEGER,
      notes TEXT,
      icon TEXT,
      icon_color TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      is_current BOOLEAN NOT NULL DEFAULT 0,
      in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
      cost_multiplier TEXT NOT NULL DEFAULT '1.0',
      limit_daily_usd TEXT,
      limit_monthly_usd TEXT,
      provider_type TEXT,
      PRIMARY KEY (id, app_type)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS provider_endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      url TEXT NOT NULL,
      added_at INTEGER,
      FOREIGN KEY (provider_id, app_type) REFERENCES providers(id, app_type) ON DELETE CASCADE
    )`);
    const columns = db.prepare("PRAGMA table_info(providers)").all().map((row) => String(row.name));
    const known = new Set(columns);
    for (const [column, definition] of AGENT_MANAGEMENT_PROVIDER_COLUMNS) {
      if (!known.has(column)) db.exec(`ALTER TABLE providers ADD COLUMN ${column} ${definition}`);
    }
  }

  function withStudioSwitchProviderDatabase(callback, options = {}) {
    const dbPath = studioSwitchDatabasePath();
    if (!options.readOnly) mkdirSyncIfNeeded(path.dirname(dbPath));
    if (options.readOnly && !existsSync(dbPath)) return callback(null);
    let db;
    try {
      db = options.readOnly ? new DatabaseSync(dbPath, { readOnly: true }) : new DatabaseSync(dbPath);
      if (!options.readOnly) ensureStudioSwitchProviderSchema(db);
      return callback(db);
    } finally {
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  }

  function mkdirSyncIfNeeded(targetPath) {
    if (!existsSync(targetPath)) mkdirSync(targetPath, { recursive: true });
  }

  function parseStudioSwitchJsonColumn(raw, fallback) {
    if (raw == null || raw === "") return fallback;
    try {
      return JSON.parse(String(raw));
    } catch {
      return fallback;
    }
  }

  function normalizeAgentManagementProviderApp(appType) {
    const value = String(appType ?? "").trim().toLowerCase();
    if (!AGENT_MANAGEMENT_PROVIDER_APPS.includes(value)) throw new Error("Unsupported provider app");
    return value;
  }

  function sanitizeProviderKey(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function positiveInteger(value) {
    const parsed = typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  }

  function inferProviderIcon(name, appType) {
    const lower = `${name} ${appType}`.toLowerCase();
    if (lower.includes("claude") || lower.includes("anthropic")) return { icon: "anthropic", iconColor: "#D4915D" };
    if (lower.includes("openai") || lower.includes("codex") || lower.includes("gpt")) return { icon: "openai", iconColor: "#00A67E" };
    if (lower.includes("qwen") || lower.includes("bailian") || lower.includes("aliyun") || lower.includes("dashscope")) return { icon: "alibaba", iconColor: "#FF6A00" };
    if (lower.includes("ark") || lower.includes("volc") || lower.includes("doubao") || lower.includes("火山")) return { icon: "huoshan", iconColor: "#3370FF" };
    if (lower.includes("kimi") || lower.includes("moonshot")) return { icon: "moonshot", iconColor: "#6366F1" };
    if (lower.includes("deepseek")) return { icon: "deepseek", iconColor: "#1E88E5" };
    if (lower.includes("minimax")) return { icon: "minimax", iconColor: "#FF6B6B" };
    if (lower.includes("z.ai") || lower.includes("zai") || lower.includes("glm") || lower.includes("zhipu")) return { icon: "zhipu", iconColor: "#0F62FE" };
    if (lower.includes("google") || lower.includes("gemini")) return { icon: "google", iconColor: "#4285F4" };
    return { icon: appType, iconColor: null };
  }

  function studioSwitchProviderFromRow(row) {
    const settingsConfig = parseStudioSwitchJsonColumn(row.settings_config, {});
    const meta = parseStudioSwitchJsonColumn(row.meta, {});
    return {
      id: String(row.id),
      appType: String(row.app_type),
      name: String(row.name),
      settingsConfig,
      websiteUrl: row.website_url ?? null,
      category: row.category ?? null,
      createdAt: row.created_at ?? null,
      sortIndex: row.sort_index ?? null,
      notes: row.notes ?? null,
      icon: row.icon ?? null,
      iconColor: row.icon_color ?? null,
      meta,
      isCurrent: Boolean(row.is_current),
      inFailoverQueue: Boolean(row.in_failover_queue),
      costMultiplier: row.cost_multiplier ?? "1.0",
      limitDailyUsd: row.limit_daily_usd ?? null,
      limitMonthlyUsd: row.limit_monthly_usd ?? null,
      providerType: row.provider_type ?? meta.providerType ?? null,
      liveManaged: meta.live_config_managed !== false,
      livePresent: false,
      models: extractAgentManagementProviderModels(String(row.app_type), settingsConfig),
    };
  }

  function readStudioSwitchProviders(appType = null) {
    return withStudioSwitchProviderDatabase((db) => {
      if (!db) return [];
      const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'providers'").get();
      if (!hasTable) return [];
      const args = [];
      let sql = `SELECT id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier, limit_daily_usd, limit_monthly_usd, provider_type
        FROM providers`;
      if (appType) {
        sql += " WHERE app_type = ?";
        args.push(appType);
      } else {
        sql += ` WHERE app_type IN (${AGENT_MANAGEMENT_PROVIDER_APPS.map(() => "?").join(",")})`;
        args.push(...AGENT_MANAGEMENT_PROVIDER_APPS);
      }
      sql += " ORDER BY app_type, COALESCE(sort_index, 999999), created_at ASC, id ASC";
      return db.prepare(sql).all(...args).map(studioSwitchProviderFromRow);
    }, { readOnly: true });
  }

  function nextStudioSwitchProviderSortIndex(db, appType) {
    const row = db.prepare("SELECT MAX(sort_index) AS max_sort FROM providers WHERE app_type = ?").get(appType);
    const maxSort = Number(row?.max_sort);
    return Number.isFinite(maxSort) ? maxSort + 1 : 0;
  }

  function normalizeAgentManagementProviderPayload(appType, inputProvider = {}) {
    const simplified = inputProvider.simple && typeof inputProvider.simple === "object" ? inputProvider.simple : null;
    const name = String(inputProvider.name ?? simplified?.name ?? "").trim();
    const fallbackId = name || simplified?.model || "custom-provider";
    const id = sanitizeProviderKey(inputProvider.id ?? simplified?.id ?? fallbackId);
    if (!id) throw new Error("Provider id is required");
    const providerName = name || id;
    let settingsConfig = inputProvider.settingsConfig;
    if (typeof settingsConfig === "string") {
      settingsConfig = parseStudioSwitchJsonColumn(settingsConfig, null);
      if (!settingsConfig) throw new Error("settingsConfig JSON is invalid");
    }
    if (!settingsConfig || typeof settingsConfig !== "object" || Array.isArray(settingsConfig)) {
      settingsConfig = buildProviderSettingsConfig(appType, { ...simplified, id, name: providerName });
    } else if (simplified) {
      settingsConfig = mergeProviderSimpleFields(appType, settingsConfig, { ...simplified, id, name: providerName });
    }
    const inferred = inferProviderIcon(providerName, appType);
    const meta = inputProvider.meta && typeof inputProvider.meta === "object" ? inputProvider.meta : {};
    return {
      id,
      appType,
      name: providerName,
      settingsConfig,
      websiteUrl: typeof inputProvider.websiteUrl === "string" ? inputProvider.websiteUrl.trim() || null : null,
      category: typeof inputProvider.category === "string" && inputProvider.category.trim() ? inputProvider.category.trim() : "custom",
      createdAt: Number.isFinite(Number(inputProvider.createdAt)) ? Number(inputProvider.createdAt) : Date.now(),
      sortIndex: Number.isFinite(Number(inputProvider.sortIndex)) ? Number(inputProvider.sortIndex) : null,
      notes: typeof inputProvider.notes === "string" ? inputProvider.notes : null,
      icon: typeof inputProvider.icon === "string" && inputProvider.icon.trim() ? inputProvider.icon.trim() : inferred.icon,
      iconColor: typeof inputProvider.iconColor === "string" && inputProvider.iconColor.trim() ? inputProvider.iconColor.trim() : inferred.iconColor,
      meta: AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS.has(appType) ? { ...meta, live_config_managed: inputProvider.liveManaged !== false } : meta,
      inFailoverQueue: Boolean(inputProvider.inFailoverQueue),
      costMultiplier: String(inputProvider.costMultiplier ?? meta.costMultiplier ?? "1.0"),
      limitDailyUsd: inputProvider.limitDailyUsd ?? null,
      limitMonthlyUsd: inputProvider.limitMonthlyUsd ?? null,
      providerType: inputProvider.providerType ?? meta.providerType ?? null,
    };
  }

  function mergeProviderSimpleFields(appType, settingsConfig, simple = {}) {
    if (!settingsConfig || typeof settingsConfig !== "object" || Array.isArray(settingsConfig)) return settingsConfig;
    if (!["claude", "codex"].includes(appType)) return settingsConfig;
    const base = structuredCloneJson(settingsConfig);
    const generated = buildProviderSettingsConfig(appType, simple);
    if (appType === "claude") {
      base.env = { ...(base.env && typeof base.env === "object" ? base.env : {}), ...(generated.env ?? {}) };
      return base;
    }
    if (appType === "codex") {
      const codexGenerated = /** @type {{ auth?: Record<string, unknown>, config?: string, modelCatalog?: unknown }} */ (generated);
      return {
        ...base,
        auth: codexGenerated.auth ?? base.auth ?? {},
        config: codexGenerated.config ?? base.config ?? "",
        ...(codexGenerated.modelCatalog ? { modelCatalog: codexGenerated.modelCatalog } : {}),
      };
    }
    return base;
  }

  function buildProviderSettingsConfig(appType, simple = {}) {
    const id = sanitizeProviderKey(simple.id ?? simple.name ?? "custom-provider");
    const name = String(simple.name ?? id).trim() || id;
    const baseUrl = String(simple.baseUrl ?? "").trim();
    const apiKey = String(simple.apiKey ?? "").trim();
    const modelList = String(simple.models ?? simple.model ?? "")
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter(Boolean);
    const model = modelList[0] ?? "model";
    const modelCapabilities = Array.isArray(simple.modelCapabilities)
      ? simple.modelCapabilities
      : [];
    const capabilityByModel = new Map(modelCapabilities.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const modelId = String(item.id ?? "").trim();
      return modelId ? [[modelId, item]] : [];
    }));
    if (appType !== "codex" && !baseUrl) throw new Error("Base URL is required");
    if (!["codex", "claude"].includes(appType) && !modelList.length) throw new Error("At least one model is required");
    if (appType === "opencode") {
      return {
        npm: "@ai-sdk/openai-compatible",
        name,
        options: { baseURL: baseUrl, ...(apiKey ? { apiKey } : {}), timeout: 600000 },
        models: Object.fromEntries(modelList.map((item) => {
          const capability = capabilityByModel.get(item);
          const context = positiveInteger(capability?.contextWindow);
          const output = positiveInteger(capability?.outputTokenLimit);
          return [item, {
            name: String(capability?.name ?? item).trim() || item,
            ...(context && output ? { limit: { context, output } } : {}),
          }];
        })),
      };
    }
    if (appType === "openclaw") {
      return {
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
        api: String(simple.api ?? "openai-completions"),
        models: modelList.map((item) => ({ id: item, name: item, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
      };
    }
    if (appType === "hermes") {
      return {
        name: id,
        base_url: baseUrl,
        ...(apiKey ? { api_key: apiKey } : {}),
        api_mode: String(simple.apiMode ?? "chat_completions"),
        model,
        models: modelList.map((item) => ({ id: item })),
        _cc_source: "studio",
      };
    }
    if (appType === "claude") {
      const haikuModel = String(simple.claudeHaikuModel ?? "").trim() || model;
      const sonnetModel = String(simple.claudeSonnetModel ?? "").trim() || model;
      const opusModel = String(simple.claudeOpusModel ?? "").trim() || sonnetModel || model;
      const fableModel = String(simple.claudeFableModel ?? "").trim() || opusModel || model;
      const haikuName = String(simple.claudeHaikuName ?? "").trim() || haikuModel;
      const sonnetName = String(simple.claudeSonnetName ?? "").trim() || sonnetModel;
      const opusName = String(simple.claudeOpusName ?? "").trim() || opusModel;
      const fableName = String(simple.claudeFableName ?? "").trim() || fableModel;
      return {
        env: {
          ANTHROPIC_BASE_URL: baseUrl,
          ...(apiKey ? { ANTHROPIC_AUTH_TOKEN: apiKey } : {}),
          ANTHROPIC_MODEL: model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
          ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: haikuName,
          ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
          ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: sonnetName,
          ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
          ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: opusName,
          ANTHROPIC_DEFAULT_FABLE_MODEL: fableModel,
          ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: fableName,
        },
      };
    }
    if (appType === "codex") {
      const providerId = id.replace(/-/g, "_");
      const envKey = String(simple.envKey ?? "CODEX_API_KEY").trim() || "CODEX_API_KEY";
      const catalogModels = parseCodexCatalogModels(simple.codexCatalog);
      const defaultModel = catalogModels[0]?.model || model;
      return {
        auth: apiKey ? { [envKey]: apiKey } : {},
        config: `model = "${escapeTomlString(defaultModel)}"\nmodel_provider = "${escapeTomlString(providerId)}"\n\n[model_providers.${providerId}]\nname = "${escapeTomlString(name)}"\nbase_url = "${escapeTomlString(baseUrl)}"\nwire_api = "responses"\nenv_key = "${escapeTomlString(envKey)}"\n`,
        ...(catalogModels.length ? { modelCatalog: { models: catalogModels } } : {}),
      };
    }
    return {};
  }

  function parseCodexCatalogModels(value) {
    const seen = new Set();
    const rows = [];
    for (const line of String(value ?? "").split(/\r?\n/g)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split("|").map((part) => part.trim());
      const displayName = parts.length > 1 ? parts[0] : "";
      const model = (parts.length > 1 ? parts[1] : parts[0]) ?? "";
      if (!model || seen.has(model)) continue;
      seen.add(model);
      const contextText = String(parts[2] ?? "").replace(/[^\d]/g, "");
      const contextWindow = contextText ? Number.parseInt(contextText, 10) : null;
      rows.push({
        model,
        ...(displayName ? { displayName } : {}),
        ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
      });
    }
    return rows;
  }

  const AGENT_MANAGEMENT_MODEL_FETCH_COMPAT_SUFFIXES = [
    "/api/claudecode",
    "/api/anthropic",
    "/apps/anthropic",
    "/api/coding",
    "/api/plan",
    "/claudecode",
    "/anthropic",
    "/step_plan",
    "/coding",
    "/claude",
    "/plan",
  ];

  function agentManagementModelsEndpoints(baseUrl) {
    const raw = String(baseUrl ?? "").trim().replace(/\/+$/g, "");
    if (!raw) throw new Error("API Endpoint is required before fetching models");
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("API Endpoint is invalid");
    }
    const candidates = [];
    const add = (value) => {
      if (value && !candidates.includes(value)) candidates.push(value);
    };
    const pathname = parsed.pathname.replace(/\/+$/g, "");
    if (/\/models$/i.test(pathname)) {
      add(parsed.toString());
    } else if (agentManagementEndsWithVersionSegment(pathname)) {
      add(`${raw}/models`);
      if (!pathname.endsWith("/v1")) add(`${raw}/v1/models`);
    } else {
      add(`${raw}/v1/models`);
      add(`${raw}/models`);
    }
    const stripped = agentManagementStripCompatSuffix(raw);
    if (stripped) {
      add(`${stripped}/v1/models`);
      add(`${stripped}/models`);
    }
    // 火山方舟（Volcengine Ark）的 coding plan / agent plan 等 compat 子产品
    // 各自有独立的 OpenAI 兼容入口（如 `/api/plan/v1/models`、`/api/coding/v1/models`），
    // 鉴权体系独立，不能混用总入口 `/api/v3/models`。
    // 当用户填入 `.../api/plan/v3` 这类版本段非 v1 的 baseUrl 时，
    // 前面生成的候选都会 404，需要补一个"同路径、版本段改 v1"的候选才能命中正确端点。
    const v1Variant = agentManagementRewriteVersionSegment(raw, "v1");
    if (v1Variant) add(`${v1Variant}/models`);
    return candidates;
  }

  function agentManagementEndsWithVersionSegment(pathname) {
    const last = String(pathname ?? "").split("/").filter(Boolean).at(-1) ?? "";
    return /^v\d+$/.test(last);
  }

  /**
   * 把 baseUrl 末尾的版本段（如 `v3`、`v2`）替换成指定的目标版本（如 `v1`），
   * 返回重写后的完整 URL 字符串。若末尾不是版本段则返回 null。
   *
   * 火山方舟 coding plan / agent plan 等子产品的用户入口 baseUrl 形如
   * `https://ark.cn-beijing.volces.com/api/plan/v3`，但其 OpenAI 兼容的
   * models 列表端点用的是 `v1` 版本段（`/api/plan/v1/models`），二者不同。
   * 直接在 `v3` 后追加 `/models` 会 404，剥离到 origin 再拼又会落到总入口
   * `/api/v3/models`（鉴权体系不通，返回 401）。把版本段重写成 `v1` 后，
   * `/api/plan/v1/models` 才是子产品自己的正确 models 端点。
   */
  function agentManagementRewriteVersionSegment(baseUrl, targetVersion) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      return null;
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    const lastIndex = segments.length - 1;
    if (lastIndex < 0) return null;
    if (!/^v\d+$/.test(segments[lastIndex])) return null;
    segments[lastIndex] = targetVersion;
    parsed.pathname = `/${segments.join("/")}`;
    return parsed.toString().replace(/\/+$/g, "");
  }

  function agentManagementStripCompatSuffix(baseUrl) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      return null;
    }
    const pathname = parsed.pathname.replace(/\/+$/g, "");
    for (const suffix of AGENT_MANAGEMENT_MODEL_FETCH_COMPAT_SUFFIXES) {
      const index = pathname.indexOf(suffix);
      if (index < 0) continue;
      const after = pathname.slice(index + suffix.length);
      if (after && !after.startsWith("/")) continue;
      const rootPath = pathname.slice(0, index).replace(/\/+$/g, "");
      return `${parsed.origin}${rootPath}`.replace(/\/+$/g, "");
    }
    return null;
  }

  function normalizeFetchedModel(item) {
    if (!item || typeof item !== "object") return null;
    const id = String(item.id ?? item.model ?? item.name ?? "").trim();
    if (!id) return null;
    const name = String(item.name ?? item.display_name ?? item.displayName ?? id).trim() || id;
    const contextWindow = item.contextWindow ?? item.context_window ?? item.max_context_length ?? item.maxContextLength ?? null;
    const outputTokenLimit = item.outputTokenLimit ?? item.output_token_limit ?? item.max_output_tokens ?? item.maxOutputTokens ?? item.max_tokens ?? item.maxTokens ?? null;
    return {
      id,
      name,
      ...(contextWindow != null ? { contextWindow } : {}),
      ...(outputTokenLimit != null ? { outputTokenLimit } : {}),
    };
  }

  async function agentManagementFetchModels(input = {}) {
    const endpoints = agentManagementModelsEndpoints(input.baseUrl);
    const apiKey = String(input.apiKey ?? "").trim();
    let lastError = "no candidates";
    for (const endpoint of endpoints) {
      let response;
      try {
        response = await fetch(endpoint, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        continue;
      }
      const text = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status}${text ? ` ${text.slice(0, 240)}` : ""}`;
        if (response.status === 404 || response.status === 405) continue;
        throw new Error(`Fetch models failed at ${endpoint}: ${lastError}`);
      }
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Fetch models failed at ${endpoint}: response is not valid JSON`);
      }
      const rawModels = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : Array.isArray(payload)
            ? payload
            : [];
      const seen = new Set();
      const models = [];
      for (const rawModel of rawModels) {
        const model = normalizeFetchedModel(rawModel);
        if (!model || seen.has(model.id)) continue;
        seen.add(model.id);
        models.push(model);
      }
      return { ok: true, endpoint, models };
    }
    throw new Error(`Fetch models failed: all candidate endpoints failed (${endpoints.join(", ")}): ${lastError}`);
  }

  function escapeTomlString(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function extractAgentManagementProviderModels(appType, settingsConfig) {
    if (!settingsConfig || typeof settingsConfig !== "object") return [];
    if (appType === "opencode" && settingsConfig.models && typeof settingsConfig.models === "object") {
      return Object.entries(settingsConfig.models).map(([id, value]) => ({
        id,
        name: String(value?.name ?? id),
        ...(value?.limit?.context != null ? { contextWindow: value.limit.context } : {}),
        ...(value?.limit?.output != null ? { outputTokenLimit: value.limit.output } : {}),
      }));
    }
    if (appType === "openclaw" && Array.isArray(settingsConfig.models)) {
      return settingsConfig.models.map((model) => ({ id: String(model?.id ?? model?.name ?? "").trim(), name: String(model?.name ?? model?.id ?? "").trim() })).filter((model) => model.id);
    }
    if (appType === "hermes") {
      if (Array.isArray(settingsConfig.models)) return settingsConfig.models.map((model) => ({ id: String(model?.id ?? model?.model ?? model?.name ?? "").trim(), name: String(model?.name ?? model?.id ?? model?.model ?? "").trim() })).filter((model) => model.id);
      if (settingsConfig.models && typeof settingsConfig.models === "object") return Object.keys(settingsConfig.models).map((id) => ({ id, name: id }));
      if (typeof settingsConfig.model === "string" && settingsConfig.model.trim()) return [{ id: settingsConfig.model.trim(), name: settingsConfig.model.trim() }];
    }
    if (appType === "claude") {
      const env = settingsConfig.env && typeof settingsConfig.env === "object" ? settingsConfig.env : settingsConfig;
      return [
        env.ANTHROPIC_MODEL,
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
        env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        env.ANTHROPIC_DEFAULT_FABLE_MODEL,
        env.model,
        settingsConfig.model,
      ].filter(Boolean).map((id) => ({ id: String(id), name: String(id) }));
    }
    if (appType === "codex") {
      const catalog = settingsConfig.modelCatalog && typeof settingsConfig.modelCatalog === "object" ? settingsConfig.modelCatalog : null;
      if (Array.isArray(catalog?.models) && catalog.models.length) {
        return catalog.models
          .map((item) => ({ id: String(item?.model ?? "").trim(), name: String(item?.displayName ?? item?.display_name ?? item?.model ?? "").trim() }))
          .filter((model) => model.id);
      }
      const config = String(settingsConfig.config ?? "");
      const model = config.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1];
      return model ? [{ id: model, name: model }] : [];
    }
    return [];
  }

  function saveStudioSwitchProvider(provider) {
    return withStudioSwitchProviderDatabase((db) => {
      const existing = db.prepare("SELECT is_current, in_failover_queue, created_at, sort_index FROM providers WHERE id = ? AND app_type = ?").get(provider.id, provider.appType);
      const createdAt = existing?.created_at ?? provider.createdAt ?? Date.now();
      const sortIndex = provider.sortIndex ?? existing?.sort_index ?? nextStudioSwitchProviderSortIndex(db, provider.appType);
      db.prepare(`INSERT INTO providers (id, app_type, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue, cost_multiplier, limit_daily_usd, limit_monthly_usd, provider_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, app_type) DO UPDATE SET
          name = excluded.name,
          settings_config = excluded.settings_config,
          website_url = excluded.website_url,
          category = excluded.category,
          created_at = excluded.created_at,
          sort_index = excluded.sort_index,
          notes = excluded.notes,
          icon = excluded.icon,
          icon_color = excluded.icon_color,
          meta = excluded.meta,
          in_failover_queue = excluded.in_failover_queue,
          cost_multiplier = excluded.cost_multiplier,
          limit_daily_usd = excluded.limit_daily_usd,
          limit_monthly_usd = excluded.limit_monthly_usd,
          provider_type = excluded.provider_type`).run(
        provider.id,
        provider.appType,
        provider.name,
        JSON.stringify(provider.settingsConfig ?? {}),
        provider.websiteUrl,
        provider.category,
        createdAt,
        sortIndex,
        provider.notes,
        provider.icon,
        provider.iconColor,
        JSON.stringify(provider.meta ?? {}),
        existing?.is_current ?? 0,
        provider.inFailoverQueue ? 1 : 0,
        provider.costMultiplier ?? "1.0",
        provider.limitDailyUsd,
        provider.limitMonthlyUsd,
        provider.providerType,
      );
      return { ...provider, createdAt, sortIndex };
    });
  }

  function setStudioSwitchCurrentProvider(appType, providerId) {
    return withStudioSwitchProviderDatabase((db) => {
      const existing = db.prepare("SELECT id FROM providers WHERE id = ? AND app_type = ?").get(providerId, appType);
      if (!existing) throw new Error(`Provider ${providerId} does not exist`);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE providers SET is_current = 0 WHERE app_type = ?").run(appType);
        db.prepare("UPDATE providers SET is_current = 1 WHERE id = ? AND app_type = ?").run(providerId, appType);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return true;
    });
  }

  function deleteStudioSwitchProvider(appType, providerId) {
    return withStudioSwitchProviderDatabase((db) => {
      db.prepare("DELETE FROM providers WHERE id = ? AND app_type = ?").run(providerId, appType);
      db.prepare("DELETE FROM provider_endpoints WHERE provider_id = ? AND app_type = ?").run(providerId, appType);
      return true;
    });
  }

  async function readAgentManagementJsonConfig(appType) {
    const configPath = agentManagementConfigPath(appType);
    return (await readJsonLikeFile(configPath)) ?? {};
  }

  async function writeOpenCodeProviderLive(provider) {
    const configPath = agentManagementConfigPath("opencode");
    const config = await readAgentManagementJsonConfig("opencode");
    const providerMap = config.provider && typeof config.provider === "object" ? config.provider : {};
    providerMap[provider.id] = provider.settingsConfig;
    config.provider = providerMap;
    await writeJsonFileAtomic(configPath, config);
  }

  async function removeOpenCodeProviderLive(providerId) {
    const configPath = agentManagementConfigPath("opencode");
    const config = await readAgentManagementJsonConfig("opencode");
    if (config.provider && typeof config.provider === "object") delete config.provider[providerId];
    if (typeof config.model === "string" && config.model.startsWith(`${providerId}/`)) delete config.model;
    if (typeof config.small_model === "string" && config.small_model.startsWith(`${providerId}/`)) delete config.small_model;
    await writeJsonFileAtomic(configPath, config);
  }

  async function writeOpenClawProviderLive(provider) {
    const configPath = agentManagementConfigPath("openclaw");
    const config = await readAgentManagementJsonConfig("openclaw");
    const models = config.models && typeof config.models === "object" ? config.models : {};
    const providers = models.providers && typeof models.providers === "object" ? models.providers : {};
    providers[provider.id] = provider.settingsConfig;
    models.providers = providers;
    config.models = models;
    await writeJsonFileAtomic(configPath, config);
  }

  async function removeOpenClawProviderLive(providerId) {
    const configPath = agentManagementConfigPath("openclaw");
    const config = await readAgentManagementJsonConfig("openclaw");
    if (config.models?.providers && typeof config.models.providers === "object") delete config.models.providers[providerId];
    await writeJsonFileAtomic(configPath, config);
  }

  async function writeClaudeProviderLive(provider) {
    await writeJsonFileAtomic(agentManagementConfigPath("claude"), sanitizeClaudeProviderSettings(provider.settingsConfig));
  }

  function sanitizeClaudeProviderSettings(settings) {
    const next = structuredCloneJson(settings && typeof settings === "object" ? settings : {});
    delete next.api_format;
    delete next.apiFormat;
    delete next.openrouter_compat_mode;
    delete next.openrouterCompatMode;
    return next;
  }

  function structuredCloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
  }

  async function writeCodexProviderLive(provider) {
    const home = getRealHomeDir();
    const codexDir = path.join(home, ".codex");
    await mkdir(codexDir, { recursive: true });
    const settings = provider.settingsConfig && typeof provider.settingsConfig === "object" ? provider.settingsConfig : {};
    await writeJsonFileAtomic(path.join(codexDir, "auth.json"), settings.auth && typeof settings.auth === "object" ? settings.auth : {});
    const current = await readFile(path.join(codexDir, "config.toml"), "utf8").catch(() => "");
    const nextConfig = mergeCodexProjectSections(String(settings.config ?? ""), current);
    await writeFile(path.join(codexDir, "config.toml"), nextConfig.endsWith("\n") ? nextConfig : `${nextConfig}\n`, "utf8");
  }

  function mergeCodexProjectSections(nextConfig, currentConfig) {
    const next = String(nextConfig ?? "").trimEnd();
    const current = String(currentConfig ?? "");
    if (/^\s*\[projects(?:\.|\])/.test(next)) return `${next}\n`;
    const projectIndex = current.search(/^\s*\[projects(?:\.|\])/m);
    if (projectIndex < 0) return `${next}\n`;
    const projectSections = current.slice(projectIndex).trimEnd();
    return `${next}\n\n${projectSections}\n`;
  }

  function yamlScalar(value) {
    if (value == null) return "''";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    const text = String(value);
    if (/^[A-Za-z0-9_./:@+-]+$/.test(text)) return text;
    return JSON.stringify(text);
  }

  function hermesProviderToYaml(providerId, settingsConfig) {
    const settings = structuredCloneJson(settingsConfig && typeof settingsConfig === "object" ? settingsConfig : {});
    settings.name = providerId;
    if (settings.baseUrl && !settings.base_url) settings.base_url = settings.baseUrl;
    if (settings.apiKey && !settings.api_key) settings.api_key = settings.apiKey;
    delete settings.baseUrl;
    delete settings.apiKey;
    delete settings.provider_key;
    delete settings._cc_source;
    const models = extractAgentManagementProviderModels("hermes", settings);
    if (models[0]?.id) settings.model = settings.model || models[0].id;
    const lines = ["- name: " + yamlScalar(providerId)];
    for (const [key, value] of Object.entries(settings)) {
      if (key === "name" || key === "models") continue;
      if (value == null || value === "") continue;
      if (typeof value === "object") continue;
      lines.push(`  ${key}: ${yamlScalar(value)}`);
    }
    if (models.length) {
      lines.push("  models:");
      for (const model of models) {
        lines.push(`    ${yamlScalar(model.id)}: {}`);
      }
    }
    return lines.join("\n");
  }

  function findTopLevelYamlSection(raw, key) {
    const pattern = new RegExp(`^${key}:\\s*(?:#.*)?$`, "m");
    const match = pattern.exec(raw);
    if (!match) return null;
    const start = match.index;
    const afterStart = start + match[0].length;
    const tail = raw.slice(afterStart);
    const next = /\n[A-Za-z0-9_-]+:\s*/.exec(tail);
    const end = next ? afterStart + next.index + 1 : raw.length;
    return { start, end, bodyStart: afterStart };
  }

  function replaceTopLevelYamlSection(raw, key, sectionText) {
    const section = sectionText.endsWith("\n") ? sectionText : `${sectionText}\n`;
    const existing = findTopLevelYamlSection(raw, key);
    if (!existing) {
      const prefix = raw && !raw.endsWith("\n") ? `${raw}\n` : raw;
      return `${prefix}${section}`;
    }
    return `${raw.slice(0, existing.start)}${section}${raw.slice(existing.end)}`;
  }

  function parseHermesCustomProviderNames(raw) {
    const section = findTopLevelYamlSection(raw, "custom_providers");
    if (!section) return new Set();
    const body = raw.slice(section.bodyStart, section.end);
    const names = new Set();
    for (const match of body.matchAll(/^\s*-\s+name:\s*["']?([^"'\n]+)["']?\s*$/gm)) {
      const name = match[1]?.trim();
      if (name) names.add(name);
    }
    return names;
  }

  function updateHermesCustomProvidersRaw(raw, provider, remove = false) {
    const section = findTopLevelYamlSection(raw, "custom_providers");
    const body = section ? raw.slice(section.bodyStart, section.end) : "";
    const blocks = [];
    let current = [];
    for (const line of body.split(/\r?\n/)) {
      if (/^\s*-\s+name:\s*/.test(line)) {
        if (current.length) blocks.push(current.join("\n"));
        current = [line];
      } else if (current.length) {
        current.push(line);
      }
    }
    if (current.length) blocks.push(current.join("\n"));
    const kept = blocks.filter((block) => {
      const name = block.match(/^\s*-\s+name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
      return name !== provider.id;
    });
    if (!remove) kept.push(hermesProviderToYaml(provider.id, provider.settingsConfig));
    const sectionText = kept.length ? `custom_providers:\n${kept.map((block) => block.trimEnd()).join("\n")}` : "custom_providers: []";
    return replaceTopLevelYamlSection(raw, "custom_providers", sectionText);
  }

  async function writeHermesProviderLive(provider) {
    const configPath = agentManagementConfigPath("hermes");
    const raw = await readFile(configPath, "utf8").catch(() => "");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, updateHermesCustomProvidersRaw(raw, provider, false), "utf8");
  }

  async function removeHermesProviderLive(providerId) {
    const configPath = agentManagementConfigPath("hermes");
    const raw = await readFile(configPath, "utf8").catch(() => "");
    await writeFile(configPath, updateHermesCustomProvidersRaw(raw, { id: providerId, settingsConfig: {} }, true), "utf8");
  }

  async function applyHermesProviderDefault(provider) {
    const configPath = agentManagementConfigPath("hermes");
    const raw = await readFile(configPath, "utf8").catch(() => "");
    const model = extractAgentManagementProviderModels("hermes", provider.settingsConfig)[0]?.id || provider.settingsConfig?.model || "";
    const sectionText = ["model:", model ? `  default: ${yamlScalar(model)}` : null, `  provider: ${yamlScalar(provider.id)}`, provider.settingsConfig?.base_url ? `  base_url: ${yamlScalar(provider.settingsConfig.base_url)}` : null].filter(Boolean).join("\n");
    await writeFile(configPath, replaceTopLevelYamlSection(raw, "model", sectionText), "utf8");
  }

  async function writeAgentManagementProviderLive(provider, options = {}) {
    if (provider.appType === "opencode") return writeOpenCodeProviderLive(provider);
    if (provider.appType === "openclaw") return writeOpenClawProviderLive(provider);
    if (provider.appType === "hermes") {
      await writeHermesProviderLive(provider);
      if (options.switchDefault) await applyHermesProviderDefault(provider);
      return;
    }
    if (provider.appType === "claude") return writeClaudeProviderLive(provider);
    if (provider.appType === "codex") return writeCodexProviderLive(provider);
    throw new Error("Unsupported live sync app");
  }

  async function removeAgentManagementProviderLive(appType, providerId) {
    if (appType === "opencode") return removeOpenCodeProviderLive(providerId);
    if (appType === "openclaw") return removeOpenClawProviderLive(providerId);
    if (appType === "hermes") return removeHermesProviderLive(providerId);
    return null;
  }

  async function readAgentManagementLiveProviderIds(appType) {
    if (appType === "opencode") {
      const config = await readAgentManagementJsonConfig("opencode");
      return new Set(Object.keys(config.provider && typeof config.provider === "object" ? config.provider : {}));
    }
    if (appType === "openclaw") {
      const config = await readAgentManagementJsonConfig("openclaw");
      return new Set(Object.keys(config.models?.providers && typeof config.models.providers === "object" ? config.models.providers : {}));
    }
    if (appType === "hermes") {
      const raw = await readFile(agentManagementConfigPath("hermes"), "utf8").catch(() => "");
      return parseHermesCustomProviderNames(raw);
    }
    return new Set();
  }

  async function readLiveProvidersForImport(appType) {
    if (appType === "opencode") {
      const config = await readAgentManagementJsonConfig("opencode");
      const providers = config.provider && typeof config.provider === "object" ? config.provider : {};
      return Object.entries(providers).map(([id, settingsConfig]) => ({
        id,
        name: settingsConfig?.name || id,
        settingsConfig,
        category: "custom",
        meta: { live_config_managed: true },
      }));
    }
    if (appType === "openclaw") {
      const config = await readAgentManagementJsonConfig("openclaw");
      const providers = config.models?.providers && typeof config.models.providers === "object" ? config.models.providers : {};
      return Object.entries(providers).map(([id, settingsConfig]) => ({
        id,
        name: extractAgentManagementProviderModels("openclaw", settingsConfig)[0]?.name || id,
        settingsConfig,
        category: "custom",
        meta: { live_config_managed: true },
      }));
    }
    if (appType === "claude") {
      const settingsConfig = await readAgentManagementJsonConfig("claude");
      if (!Object.keys(settingsConfig).length) return [];
      return [{ id: "default", name: "default", settingsConfig, category: "custom", meta: {} }];
    }
    if (appType === "codex") {
      const home = getRealHomeDir();
      const [auth, config] = await Promise.all([
        readJsonLikeFile(path.join(home, ".codex", "auth.json")),
        readFile(path.join(home, ".codex", "config.toml"), "utf8").catch(() => ""),
      ]);
      if (!auth && !config.trim()) return [];
      return [{ id: "default", name: "default", settingsConfig: { auth: auth ?? {}, config }, category: "custom", meta: {} }];
    }
    if (appType === "hermes") {
      const raw = await readFile(agentManagementConfigPath("hermes"), "utf8").catch(() => "");
      return parseHermesCustomProvidersForImport(raw);
    }
    return [];
  }

  function parseHermesCustomProvidersForImport(raw) {
    const section = findTopLevelYamlSection(raw, "custom_providers");
    if (!section) return [];
    const body = raw.slice(section.bodyStart, section.end);
    const blocks = [];
    let current = [];
    for (const line of body.split(/\r?\n/)) {
      if (/^\s*-\s+name:\s*/.test(line)) {
        if (current.length) blocks.push(current.join("\n"));
        current = [line];
      } else if (current.length) {
        current.push(line);
      }
    }
    if (current.length) blocks.push(current.join("\n"));
    return blocks.map((block) => {
      const scalars = {};
      const modelIds = [];
      for (const line of block.split(/\r?\n/)) {
        const scalar = line.match(/^\s*(?:-\s+)?([A-Za-z0-9_]+):\s*["']?([^"'{}\n]+)["']?\s*$/);
        if (scalar) scalars[scalar[1]] = scalar[2].trim();
        const model = line.match(/^\s{4}([^:\n]+):\s*(?:\{\})?\s*$/);
        if (model) modelIds.push(model[1].replace(/^['"]|['"]$/g, "").trim());
      }
      const id = sanitizeProviderKey(scalars.name);
      if (!id) return null;
      const models = modelIds.length ? modelIds : scalars.model ? [scalars.model] : [];
      return {
        id,
        name: scalars.name || id,
        settingsConfig: {
          name: id,
          base_url: scalars.base_url || "",
          ...(scalars.api_key ? { api_key: scalars.api_key } : {}),
          api_mode: scalars.api_mode || "chat_completions",
          ...(scalars.model ? { model: scalars.model } : {}),
          models: models.map((modelId) => ({ id: modelId })),
          _cc_source: "custom_providers",
        },
        category: "custom",
        meta: { live_config_managed: true },
      };
    }).filter(Boolean);
  }

  async function readAgentManagementProvidersSnapshot() {
    const providers = readStudioSwitchProviders();
    const liveByApp = new Map();
    await Promise.all(AGENT_MANAGEMENT_PROVIDER_APPS.map(async (appType) => {
      liveByApp.set(appType, await readAgentManagementLiveProviderIds(appType).catch(() => new Set()));
    }));
    const byAgent = Object.fromEntries(AGENT_MANAGEMENT_PROVIDER_APPS.map((appType) => [appType, []]));
    for (const provider of providers) {
      const liveIds = liveByApp.get(provider.appType) ?? new Set();
      const enriched = {
        ...provider,
        livePresent: provider.isCurrent || liveIds.has(provider.id),
        configPath: agentManagementConfigPath(provider.appType),
      };
      if (byAgent[provider.appType]) byAgent[provider.appType].push(enriched);
    }
    return {
      databasePath: studioSwitchDatabasePath(),
      byAgent,
      total: providers.length,
    };
  }

  async function agentManagementProviderAction(input = {}) {
    const action = String(input?.action ?? "").trim();
    const appType = normalizeAgentManagementProviderApp(input?.appType ?? input?.agent);
    if (action === "importLive") {
      const liveProviders = await readLiveProvidersForImport(appType);
      const existingIds = new Set(readStudioSwitchProviders(appType).map((provider) => provider.id));
      let imported = 0;
      for (const rawProvider of liveProviders) {
        if (!rawProvider?.id || existingIds.has(rawProvider.id)) continue;
        const provider = normalizeAgentManagementProviderPayload(appType, rawProvider);
        provider.meta = { ...(provider.meta ?? {}), live_config_managed: true };
        saveStudioSwitchProvider(provider);
        imported += 1;
      }
      return { ok: true, action, appType, imported, providers: await readAgentManagementProvidersSnapshot() };
    }

    if (action === "save") {
      const provider = normalizeAgentManagementProviderPayload(appType, input?.provider ?? input);
      const saved = saveStudioSwitchProvider(provider);
      if (input?.syncLive !== false && AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS.has(appType)) {
        await writeAgentManagementProviderLive(saved);
      }
      return { ok: true, action, appType, providerId: saved.id, providers: await readAgentManagementProvidersSnapshot() };
    }

    const providerId = sanitizeProviderKey(input?.providerId ?? input?.id ?? input?.provider?.id);
    if (!providerId) throw new Error("providerId is required");

    if (action === "syncLive") {
      const provider = readStudioSwitchProviders(appType).find((item) => item.id === providerId);
      if (!provider) throw new Error(`Provider ${providerId} does not exist`);
      await writeAgentManagementProviderLive(provider);
      return { ok: true, action, appType, providerId, providers: await readAgentManagementProvidersSnapshot() };
    }

    if (action === "switch") {
      const provider = readStudioSwitchProviders(appType).find((item) => item.id === providerId);
      if (!provider) throw new Error(`Provider ${providerId} does not exist`);
      if (AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS.has(appType)) {
        await writeAgentManagementProviderLive(provider, { switchDefault: true });
        if (appType === "opencode") {
          const modelId = provider.models[0]?.id;
          if (modelId) {
            const configPath = agentManagementConfigPath("opencode");
            const config = await readAgentManagementJsonConfig("opencode");
            config.model = `${provider.id}/${modelId}`;
            await writeJsonFileAtomic(configPath, config);
          }
        }
      } else {
        setStudioSwitchCurrentProvider(appType, providerId);
        await writeAgentManagementProviderLive(provider);
      }
      return { ok: true, action, appType, providerId, providers: await readAgentManagementProvidersSnapshot() };
    }

    if (action === "delete") {
      if (AGENT_MANAGEMENT_ADDITIVE_PROVIDER_APPS.has(appType)) {
        await removeAgentManagementProviderLive(appType, providerId);
      } else {
        const provider = readStudioSwitchProviders(appType).find((item) => item.id === providerId);
        if (provider?.isCurrent) throw new Error("无法删除当前正在使用的供应商");
      }
      deleteStudioSwitchProvider(appType, providerId);
      return { ok: true, action, appType, providerId, providers: await readAgentManagementProvidersSnapshot() };
    }

    throw new Error("Unsupported provider action");
  }

  return {
    agentManagementFetchModels,
    agentManagementProviderAction,
    readAgentManagementProvidersSnapshot,
  };
}
