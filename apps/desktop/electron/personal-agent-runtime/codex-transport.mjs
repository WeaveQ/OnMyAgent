import { readFileSync } from "node:fs";
import path from "node:path";

const HTTPS_PROVIDER_ID = "onmyagent_openai_https";
const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const API_KEY_CODEX_BASE_URL = "https://api.openai.com/v1";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function codexHome(environment) {
  const explicit = String(environment.CODEX_HOME ?? "").trim();
  if (explicit) return explicit;
  const home = String(environment.HOME ?? environment.USERPROFILE ?? "").trim();
  return home ? path.join(home, ".codex") : "";
}

function readText(filePath) {
  if (!filePath) return "";
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function configuredModelProvider(environment) {
  const root = codexHome(environment);
  const config = readText(root ? path.join(root, "config.toml") : "");
  const match = /^\s*model_provider\s*=\s*["']([^"']+)["']/m.exec(config);
  return String(match?.[1] ?? "").trim();
}

function authMode(environment) {
  const root = codexHome(environment);
  const raw = readText(root ? path.join(root, "auth.json") : "");
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed?.auth_mode ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function httpsBaseUrlForAuthMode(mode) {
  if (mode === "chatgpt" || mode === "chat-gpt") return CHATGPT_CODEX_BASE_URL;
  if (mode === "api_key" || mode === "api-key" || mode === "apikey") return API_KEY_CODEX_BASE_URL;
  return "";
}

/**
 * Codex's built-in OpenAI provider currently prefers Responses WebSockets.
 * On networks that drop the upgrade, every turn waits through the complete
 * retry budget before Codex falls back to HTTPS. Give OnMyAgent's managed ACP
 * process an equivalent HTTPS-only provider while leaving the user's Codex
 * config on disk untouched. Explicit/custom providers always win.
 *
 * @param {Record<string, string | undefined>} environment
 */
export function preferCodexHttpsTransport(environment) {
  if (!environment || typeof environment !== "object") return environment;
  if (String(environment.MODEL_PROVIDER ?? "").trim()) return environment;
  if (configuredModelProvider(environment)) return environment;

  const rawConfig = String(environment.CODEX_CONFIG ?? "").trim();
  let existing = {};
  if (rawConfig) {
    try {
      const parsed = JSON.parse(rawConfig);
      if (!isRecord(parsed)) return environment;
      existing = parsed;
    } catch {
      return environment;
    }
  }
  if (String(existing.model_provider ?? "").trim()) return environment;

  const baseUrl = httpsBaseUrlForAuthMode(authMode(environment));
  if (!baseUrl) return environment;
  const existingProviders = isRecord(existing.model_providers) ? existing.model_providers : {};
  return {
    ...environment,
    MODEL_PROVIDER: HTTPS_PROVIDER_ID,
    CODEX_CONFIG: JSON.stringify({
      ...existing,
      model_provider: HTTPS_PROVIDER_ID,
      model_providers: {
        ...existingProviders,
        [HTTPS_PROVIDER_ID]: {
          name: "OpenAI HTTPS",
          base_url: baseUrl,
          wire_api: "responses",
          requires_openai_auth: true,
          supports_websockets: false,
        },
      },
    }),
  };
}

export const __test__ = {
  API_KEY_CODEX_BASE_URL,
  CHATGPT_CODEX_BASE_URL,
  HTTPS_PROVIDER_ID,
};
