/**
 * Den build-time defaults and pure URL/config helpers.
 * No session storage / network (except thin pure wrappers over den-url-parse).
 */

import {
  normalizeDesktopConfig,
  type DesktopConfig as SharedDesktopConfig,
} from "@onmyagent/types/den/desktop-policies";
import {
  buildDenAuthUrl as buildDenAuthUrlPure,
  normalizeDenBaseUrl as normalizeDenBaseUrlPure,
  resolveDenBaseUrls as resolveDenBaseUrlsPure,
} from "./den-url-parse";
import type { DenDesktopConfig } from "./den-api-types";

export type { SharedDesktopConfig };
export { normalizeDesktopConfig };

export const DEFAULT_DEN_AUTH_NAME = "OnMyAgent User";

const BUILD_DEN_BASE_URL =
  (typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_DEN_BASE_URL === "string"
    ? import.meta.env.VITE_DEN_BASE_URL
    : "").trim() || "https://app.onmyagentlabs.com";
const BUILD_DEN_API_BASE_URL =
  (typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_DEN_API_BASE_URL === "string"
    ? import.meta.env.VITE_DEN_API_BASE_URL
    : "").trim() || undefined;
const BUILD_DEN_REQUIRE_SIGNIN =
  (typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_DEN_REQUIRE_SIGNIN === "string"
    ? /^(1|true|yes|on)$/i.test(import.meta.env.VITE_DEN_REQUIRE_SIGNIN.trim())
    : false);

export const DEFAULT_DEN_BASE_URL = BUILD_DEN_BASE_URL;
export { BUILD_DEN_BASE_URL, BUILD_DEN_API_BASE_URL, BUILD_DEN_REQUIRE_SIGNIN };

export function normalizeDenBaseUrl(input: string | null | undefined): string | null {
  return normalizeDenBaseUrlPure(input);
}

export function resolveDenBaseUrls(
  input: { baseUrl?: string | null; apiBaseUrl?: string | null } | string | null | undefined,
) {
  return resolveDenBaseUrlsPure(input, DEFAULT_DEN_BASE_URL);
}

export function buildDenAuthUrl(baseUrl: string, mode: "sign-in" | "sign-up"): string {
  return buildDenAuthUrlPure(baseUrl, mode);
}

export const DEN_INFERENCE_PATH = "/dashboard/inference";

export function normalizeDenDesktopConfig(payload: unknown): DenDesktopConfig {
  return normalizeDesktopConfig(payload);
}
