/**
 * Pure Den URL normalization helpers (no network / storage / bootstrap).
 * Extracted from den.ts for file-size and unit testing (P2).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeDenBaseUrl(
  input: string | null | undefined,
): string | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function isWebAppHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  ) {
    return true;
  }

  const ipv4Match = normalized.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (ipv4Match) {
    const [first, second, third, fourth] = ipv4Match.slice(1).map(Number);
    const octets = [first, second, third, fourth];
    if (
      octets.every(
        (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
      )
    ) {
      if (
        first === 10 ||
        first === 127 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 169 && second === 254) ||
        (first === 100 && second >= 64 && second <= 127)
      ) {
        return true;
      }
    }
  }

  return (
    normalized === "app.onmyagentlabs.com" ||
    normalized === "app.onmyagent.software" ||
    normalized.startsWith("app.")
  );
}

export function stripDenApiBasePath(
  input: string | null | undefined,
): string | null {
  const normalized = normalizeDenBaseUrl(input);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    const suffix = "/api/den";
    if (!pathname.toLowerCase().endsWith(suffix)) {
      return normalized;
    }

    const nextPathname = pathname.slice(0, -suffix.length) || "/";
    url.pathname = nextPathname;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}

export function ensureDenApiBasePath(
  input: string | null | undefined,
): string | null {
  const normalized = normalizeDenBaseUrl(input);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.toLowerCase().endsWith("/api/den")) {
      return normalized;
    }
    url.pathname = `${pathname}/api/den`.replace(/\/+/g, "/");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}

export function deriveDenApiBaseUrl(
  input: string | null | undefined,
  fallbackBaseUrl: string,
): string {
  const normalized = normalizeDenBaseUrl(input) ?? fallbackBaseUrl;

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.toLowerCase().endsWith("/api/den")) {
      return normalized;
    }
    if (isWebAppHost(url.hostname)) {
      return ensureDenApiBasePath(normalized) ?? normalized;
    }
  } catch {
    return normalized;
  }

  return normalized;
}

export function resolveDenBaseUrls(
  input:
    | { baseUrl?: string | null; apiBaseUrl?: string | null }
    | string
    | null
    | undefined,
  fallbackBaseUrl: string,
): { baseUrl: string; apiBaseUrl: string } {
  const rawBaseUrl = typeof input === "string" ? input : input?.baseUrl;
  const rawApiBaseUrl = typeof input === "string" ? null : input?.apiBaseUrl;
  const normalizedBaseUrl = normalizeDenBaseUrl(rawBaseUrl);
  const normalizedApiBaseUrl = normalizeDenBaseUrl(rawApiBaseUrl);
  const seedUrl =
    normalizedBaseUrl ?? normalizedApiBaseUrl ?? fallbackBaseUrl;

  return {
    baseUrl:
      stripDenApiBasePath(normalizedBaseUrl ?? seedUrl) ?? fallbackBaseUrl,
    apiBaseUrl:
      normalizedApiBaseUrl ?? deriveDenApiBaseUrl(seedUrl, fallbackBaseUrl),
  };
}

export function buildDenAuthUrl(
  baseUrl: string,
  mode: "sign-in" | "sign-up",
): string {
  const normalized = normalizeDenBaseUrl(baseUrl) ?? baseUrl;
  const path = mode === "sign-up" ? "/sign-up" : "/sign-in";
  return `${normalized.replace(/\/+$/, "")}${path}`;
}
