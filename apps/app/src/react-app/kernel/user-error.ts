/**
 * Product-facing error templates for a few high-traffic scenarios.
 * Keep titles short; bodies always include a recovery hint.
 */
import { t } from "../../i18n";

export type UserErrorScenario =
  | "boot_failed"
  | "not_connected"
  | "providers_load_failed"
  | "connect_provider_failed"
  | "remote_workspace_failed"
  | "request_failed";

export type UserErrorActionId =
  | "retry"
  | "open_ai_settings"
  | "open_releases"
  | "reload_app";

export type UserErrorCopy = {
  scenario: UserErrorScenario;
  title: string;
  body: string;
  /** Optional primary recovery action id for hosts to wire. */
  primaryAction: UserErrorActionId | null;
  primaryActionLabel: string | null;
};

/**
 * Resolve user-visible title/body for a known scenario.
 * `detail` is only used when short and non-technical; never prefer stacks.
 */
export function userErrorCopy(
  scenario: UserErrorScenario,
  detail?: string | null,
): UserErrorCopy {
  const safeDetail = sanitizeDetail(detail);

  switch (scenario) {
    case "boot_failed":
      return {
        scenario,
        title: t("system.boot_error"),
        body: t("system.boot_start_runtime_failed"),
        primaryAction: "reload_app",
        primaryActionLabel: t("system.error_action_reload_app"),
      };
    case "not_connected":
      return {
        scenario,
        title: t("system.error_not_connected_title"),
        body: t("system.error_not_connected_body"),
        primaryAction: "retry",
        primaryActionLabel: t("system.error_action_retry"),
      };
    case "providers_load_failed":
      return {
        scenario,
        title: t("system.error_providers_load_title"),
        body: withOptionalDetail(
          t("system.error_providers_load_body"),
          safeDetail,
        ),
        primaryAction: "retry",
        primaryActionLabel: t("system.error_action_retry"),
      };
    case "connect_provider_failed":
      return {
        scenario,
        title: t("system.error_connect_provider_title"),
        body: withOptionalDetail(
          t("system.error_connect_provider_body"),
          safeDetail,
        ),
        primaryAction: "open_ai_settings",
        primaryActionLabel: t("system.error_action_open_ai_settings"),
      };
    case "remote_workspace_failed":
      return {
        scenario,
        title: t("system.error_remote_workspace_title"),
        body: withOptionalDetail(
          t("system.error_remote_workspace_body"),
          safeDetail,
        ),
        primaryAction: "retry",
        primaryActionLabel: t("system.error_action_retry"),
      };
    case "request_failed":
    default:
      return {
        scenario: "request_failed",
        title: t("system.error_request_title"),
        body: withOptionalDetail(t("system.error_request_body"), safeDetail),
        primaryAction: "retry",
        primaryActionLabel: t("system.error_action_retry"),
      };
  }
}

/**
 * Single-line string for hosts that only accept a string error slot
 * (route banner, provider action error, etc.).
 */
export function userErrorMessage(
  scenario: UserErrorScenario,
  detail?: string | null,
): string {
  const copy = userErrorCopy(scenario, detail);
  return `${copy.title}. ${copy.body}`;
}

/**
 * Classify a raw/SDK error message and return product-facing copy.
 * Prefer this over surfacing describeRouteError() / error.message directly.
 */
export function userErrorFromRaw(message: string | null | undefined): string {
  const classified = classifyProviderError(message);
  return userErrorMessage(classified.scenario, classified.detail);
}

/** Classify common provider/auth error strings into a scenario. */
export function classifyProviderError(message: string | null | undefined): {
  scenario: UserErrorScenario;
  detail: string | null;
} {
  const raw = (message ?? "").trim();
  if (!raw) {
    return { scenario: "request_failed", detail: null };
  }
  const lower = raw.toLowerCase();
  if (
    lower.includes("not connected") ||
    lower.includes("no server") ||
    lower.includes("connect first") ||
    raw.includes("未连接") ||
    raw.includes("请先连接")
  ) {
    return { scenario: "not_connected", detail: sanitizeDetail(raw) };
  }
  if (
    lower.includes("load") &&
    (lower.includes("provider") || raw.includes("服务商"))
  ) {
    return { scenario: "providers_load_failed", detail: sanitizeDetail(raw) };
  }
  if (
    lower.includes("disconnect") ||
    lower.includes("connect") ||
    lower.includes("oauth") ||
    lower.includes("auth") ||
    lower.includes("api key") ||
    raw.includes("连接") ||
    raw.includes("断开")
  ) {
    return { scenario: "connect_provider_failed", detail: sanitizeDetail(raw) };
  }
  if (lower.includes("remote") || raw.includes("远程")) {
    return { scenario: "remote_workspace_failed", detail: sanitizeDetail(raw) };
  }
  return { scenario: "request_failed", detail: sanitizeDetail(raw) };
}

function sanitizeDetail(detail?: string | null): string | null {
  if (!detail) return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;
  if (
    trimmed.includes("\n") ||
    /Error:|at\s+\S+\s+\(|ENOENT|ECONNREFUSED|TypeError/i.test(trimmed) ||
    trimmed.length > 120
  ) {
    return null;
  }
  return trimmed;
}

function withOptionalDetail(body: string, detail: string | null): string {
  if (!detail) return body;
  // Avoid duplicating if body already contains the same idea.
  if (body.includes(detail)) return body;
  return `${body} (${detail})`;
}
