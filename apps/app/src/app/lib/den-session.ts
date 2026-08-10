/**
 * Den bootstrap config + local session settings (localStorage).
 * No HTTP client — createDenClient lives in den-client.ts.
 */

import {
  dispatchDenSettingsChanged,
} from "./den-session-events";
import {
  getDesktopBootstrapConfig as getDesktopBootstrapConfigFromShell,
  setDesktopBootstrapConfig as setDesktopBootstrapConfigInShell,
  type DesktopBootstrapConfig as ShellDesktopBootstrapConfig,
} from "./desktop";
import { isDesktopRuntime } from "../utils";
import type { DenSettings } from "./den-types";
import type { DenBootstrapConfig } from "./den-api-types";
import {
  BUILD_DEN_API_BASE_URL,
  BUILD_DEN_BASE_URL,
  BUILD_DEN_REQUIRE_SIGNIN,
  DEFAULT_DEN_BASE_URL,
  DEN_INFERENCE_PATH,
  normalizeDenBaseUrl,
  resolveDenBaseUrls,
} from "./den-config";

const STORAGE_BASE_URL = "onmyagent.den.baseUrl";
const STORAGE_API_BASE_URL = "onmyagent.den.apiBaseUrl";
const STORAGE_AUTH_TOKEN = "onmyagent.den.authToken";
const STORAGE_ACTIVE_ORG_ID = "onmyagent.den.activeOrgId";
const STORAGE_ACTIVE_ORG_SLUG = "onmyagent.den.activeOrgSlug";
const STORAGE_ACTIVE_ORG_NAME = "onmyagent.den.activeOrgName";

const defaultBootstrapBaseUrls = resolveDenBaseUrls({
  baseUrl: BUILD_DEN_BASE_URL,
  apiBaseUrl: BUILD_DEN_API_BASE_URL,
});

let desktopBootstrapConfig: DenBootstrapConfig = {
  ...defaultBootstrapBaseUrls,
  requireSignin: BUILD_DEN_REQUIRE_SIGNIN,
};

export function getDenInferenceUrl(baseUrl?: string | null): string {
  const normalized = normalizeDenBaseUrl(baseUrl ?? readDenSettings().baseUrl) ?? DEFAULT_DEN_BASE_URL;
  return `${normalized}${DEN_INFERENCE_PATH}`;
}

function resolveDenBootstrapConfig(
  input: { baseUrl: string; apiBaseUrl?: string | null; requireSignin?: boolean | null },
): DenBootstrapConfig {
  return {
    ...resolveDenBaseUrls(input),
    requireSignin: input.requireSignin === true,
  };
}

function syncBootstrapSettingsToLocalStorage(config: DenBootstrapConfig) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_BASE_URL, config.baseUrl);
  window.localStorage.setItem(STORAGE_API_BASE_URL, config.apiBaseUrl);
}

function getPendingBootstrapConfig(next: DenSettings): DenBootstrapConfig | null {
  if (next.baseUrl === undefined && next.apiBaseUrl === undefined) {
    return null;
  }

  const previous = readDenBootstrapConfig();
  return resolveDenBootstrapConfig({
    baseUrl: next.baseUrl ?? previous.baseUrl,
    apiBaseUrl: next.apiBaseUrl ?? previous.apiBaseUrl,
    requireSignin: previous.requireSignin,
  });
}

function applyDesktopBootstrapConfig(config: DenBootstrapConfig) {
  desktopBootstrapConfig = config;
  syncBootstrapSettingsToLocalStorage(config);
}

export function readDenBootstrapConfig(): DenBootstrapConfig {
  return desktopBootstrapConfig;
}

export async function initializeDenBootstrapConfig(): Promise<DenBootstrapConfig> {
  if (!isDesktopRuntime()) {
    desktopBootstrapConfig = resolveDenBootstrapConfig({
      baseUrl: BUILD_DEN_BASE_URL,
      apiBaseUrl: BUILD_DEN_API_BASE_URL,
      requireSignin: BUILD_DEN_REQUIRE_SIGNIN,
    });
    return desktopBootstrapConfig;
  }

  try {
    const bootstrap = await getDesktopBootstrapConfigFromShell() as ShellDesktopBootstrapConfig;
    applyDesktopBootstrapConfig(resolveDenBootstrapConfig(bootstrap));
  } catch {
    desktopBootstrapConfig = resolveDenBootstrapConfig({
      baseUrl: BUILD_DEN_BASE_URL,
      apiBaseUrl: BUILD_DEN_API_BASE_URL,
      requireSignin: BUILD_DEN_REQUIRE_SIGNIN,
    });
    syncBootstrapSettingsToLocalStorage(desktopBootstrapConfig);
  }

  return desktopBootstrapConfig;
}

export async function setDenBootstrapConfig(
  next: ShellDesktopBootstrapConfig,
): Promise<DenBootstrapConfig> {
  const normalized = resolveDenBootstrapConfig(next);

  if (isDesktopRuntime()) {
    const persisted = await setDesktopBootstrapConfigInShell({
      baseUrl: normalized.baseUrl,
      apiBaseUrl: normalized.apiBaseUrl,
      requireSignin: normalized.requireSignin,
    }) as ShellDesktopBootstrapConfig;

    applyDesktopBootstrapConfig(resolveDenBootstrapConfig(persisted));
  } else {
    applyDesktopBootstrapConfig(normalized);
  }

  dispatchDenSettingsChanged({
    settings: readDenSettings(),
  });

  return readDenBootstrapConfig();
}

export function readDenSettings(): DenSettings {
  if (typeof window === "undefined") {
    return {
      ...readDenBootstrapConfig(),
      authToken: null,
      activeOrgId: null,
      activeOrgSlug: null,
      activeOrgName: null,
    };
  }

  const baseUrls = resolveDenBaseUrls({
    baseUrl: window.localStorage.getItem(STORAGE_BASE_URL) ?? readDenBootstrapConfig().baseUrl,
    apiBaseUrl: window.localStorage.getItem(STORAGE_API_BASE_URL) ?? readDenBootstrapConfig().apiBaseUrl,
  });

  return {
    ...baseUrls,
    authToken: (window.localStorage.getItem(STORAGE_AUTH_TOKEN) ?? "").trim() || null,
    activeOrgId: (window.localStorage.getItem(STORAGE_ACTIVE_ORG_ID) ?? "").trim() || null,
    activeOrgSlug: (window.localStorage.getItem(STORAGE_ACTIVE_ORG_SLUG) ?? "").trim() || null,
    activeOrgName: (window.localStorage.getItem(STORAGE_ACTIVE_ORG_NAME) ?? "").trim() || null,
  };
}

export function writeDenSettings(next: DenSettings, options?: { persistBootstrap?: boolean }) {
  if (typeof window === "undefined") {
    return;
  }

  const pendingBootstrap = getPendingBootstrapConfig(next);
  const previous = readDenSettings();
  const resolved = resolveDenBaseUrls(next);
  const previousResolved = resolveDenBaseUrls(previous);
  const baseUrl = resolved.baseUrl;
  const apiBaseUrl = next.apiBaseUrl !== undefined
    ? resolved.apiBaseUrl
    : previousResolved.baseUrl === resolved.baseUrl
      ? previous.apiBaseUrl ?? resolved.apiBaseUrl
      : resolved.apiBaseUrl;
  const authToken = next.authToken?.trim() ?? "";
  const activeOrgId = next.activeOrgId?.trim() ?? "";
  const activeOrgSlug = next.activeOrgSlug?.trim() ?? "";
  const activeOrgName = next.activeOrgName?.trim() ?? "";

  if (
    previous.baseUrl === baseUrl &&
    (previous.apiBaseUrl ?? "") === apiBaseUrl &&
    (previous.authToken ?? "") === authToken &&
    (previous.activeOrgId ?? "") === activeOrgId &&
    (previous.activeOrgSlug ?? "") === activeOrgSlug &&
    (previous.activeOrgName ?? "") === activeOrgName
  ) {
    return;
  }

  window.localStorage.setItem(STORAGE_BASE_URL, baseUrl);
  window.localStorage.setItem(STORAGE_API_BASE_URL, apiBaseUrl);
  if (authToken) {
    window.localStorage.setItem(STORAGE_AUTH_TOKEN, authToken);
  } else {
    window.localStorage.removeItem(STORAGE_AUTH_TOKEN);
  }

  if (activeOrgId) {
    window.localStorage.setItem(STORAGE_ACTIVE_ORG_ID, activeOrgId);
  } else {
    window.localStorage.removeItem(STORAGE_ACTIVE_ORG_ID);
  }

  if (activeOrgSlug) {
    window.localStorage.setItem(STORAGE_ACTIVE_ORG_SLUG, activeOrgSlug);
  } else {
    window.localStorage.removeItem(STORAGE_ACTIVE_ORG_SLUG);
  }

  if (activeOrgName) {
    window.localStorage.setItem(STORAGE_ACTIVE_ORG_NAME, activeOrgName);
  } else {
    window.localStorage.removeItem(STORAGE_ACTIVE_ORG_NAME);
  }

  if (options?.persistBootstrap !== false && pendingBootstrap) {
    const currentBootstrap = readDenBootstrapConfig();
    if (
      pendingBootstrap.baseUrl !== currentBootstrap.baseUrl ||
      pendingBootstrap.apiBaseUrl !== currentBootstrap.apiBaseUrl
    ) {
      void setDenBootstrapConfig({
        baseUrl: pendingBootstrap.baseUrl,
        apiBaseUrl: pendingBootstrap.apiBaseUrl,
        requireSignin: currentBootstrap.requireSignin,
      }).catch(() => undefined);
    }
  }

  dispatchDenSettingsChanged({
    settings: readDenSettings(),
  });
}

export function clearDenSession(options?: { includeBaseUrls?: boolean }) {
  if (typeof window === "undefined") {
    return;
  }

  if (options?.includeBaseUrls) {
    window.localStorage.removeItem(STORAGE_BASE_URL);
    window.localStorage.removeItem(STORAGE_API_BASE_URL);
  }

  window.localStorage.removeItem(STORAGE_AUTH_TOKEN);
  window.localStorage.removeItem(STORAGE_ACTIVE_ORG_ID);
  window.localStorage.removeItem(STORAGE_ACTIVE_ORG_SLUG);
  window.localStorage.removeItem(STORAGE_ACTIVE_ORG_NAME);

  dispatchDenSettingsChanged({
    settings: readDenSettings(),
  });
}
