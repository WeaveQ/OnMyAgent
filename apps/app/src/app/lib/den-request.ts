/**
 * Low-level Den HTTP helpers (timeout, JSON request, active-org POST).
 */

import { desktopFetch } from "./desktop";
import { isDesktopRuntime } from "../utils";
import { resolveDenBaseUrls } from "./den-config";
import {
  DenApiError,
  type DenBaseUrls,
  type RawJsonResponse,
} from "./den-api-types";
import { getErrorMessage } from "./den-api-parse";
import { isRecord } from "./den-url-parse";

const ORG_PROXY_HEADER = "x-onmyagent-legacy-org-id";
const DEFAULT_DEN_TIMEOUT_MS = 12_000;

function resolveRequestBaseUrl(baseUrls: DenBaseUrls, path: string): string {
  return path.startsWith("/api/") ? baseUrls.baseUrl : baseUrls.apiBaseUrl;
}

const resolveFetch = () => (isDesktopRuntime() ? desktopFetch : globalThis.fetch);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type DenRequestOptions = {
  method?: string;
  token?: string | null;
  body?: unknown;
  timeoutMs?: number;
  organizationId?: string | null;
};

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchImpl(url, init);
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = controller?.signal;
  const initWithSignal = signal && !init.signal ? { ...init, signal } : init;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // ignore
      }
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchImpl(url, initWithSignal), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function requestJsonRaw<T>(
  input: string | DenBaseUrls,
  path: string,
  options: DenRequestOptions = {},
): Promise<RawJsonResponse<T>> {
  const baseUrls = typeof input === "string" ? resolveDenBaseUrls(input) : input;
  const url = `${resolveRequestBaseUrl(baseUrls, path)}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = options.token?.trim() ?? "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const organizationId = options.organizationId?.trim() ?? "";
  if (organizationId) {
    headers[ORG_PROXY_HEADER] = organizationId;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithTimeout(
    resolveFetch(),
    url,
    {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "include",
    },
    options.timeoutMs ?? DEFAULT_DEN_TIMEOUT_MS,
  );

  const text = await response.text();
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, json };
}

export async function requestJson<T>(
  input: string | DenBaseUrls,
  path: string,
  options: DenRequestOptions = {},
): Promise<T> {
  const raw = await requestJsonRaw<T>(input, path, options);
  if (!raw.ok) {
    const payload = raw.json;
    const code = isRecord(payload) && typeof payload.error === "string" ? payload.error : "request_failed";
    const message = getErrorMessage(payload, `Request failed with ${raw.status}.`);
    throw new DenApiError(raw.status, code, message, isRecord(payload) ? payload.details : undefined);
  }
  return raw.json as T;
}

export async function ensureActiveOrganization(
  baseUrls: DenBaseUrls,
  token: string | null,
  input: { organizationId?: string | null; organizationSlug?: string | null },
) {
  const organizationId = input.organizationId?.trim() ?? "";
  const organizationSlug = input.organizationSlug?.trim() ?? "";
  if (!token || (!organizationId && !organizationSlug)) {
    return;
  }

  await requestJson<unknown>(baseUrls, "/v1/me/active-organization", {
    method: "POST",
    token,
    body: {
      organizationId: organizationId || undefined,
      organizationSlug: organizationSlug || undefined,
    },
  });
}
