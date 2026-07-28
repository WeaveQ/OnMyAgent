import { describe, expect, test } from "bun:test";

import {
  deriveDenApiBaseUrl,
  ensureDenApiBasePath,
  isWebAppHost,
  normalizeDenBaseUrl,
  resolveDenBaseUrls,
  stripDenApiBasePath,
} from "../src/app/lib/den-url-parse";

describe("den-url-parse (shipped)", () => {
  test("normalizeDenBaseUrl accepts http(s) and strips trailing slash", () => {
    expect(normalizeDenBaseUrl("https://app.example.com/")).toBe(
      "https://app.example.com",
    );
    expect(normalizeDenBaseUrl("ftp://x")).toBeNull();
    expect(normalizeDenBaseUrl("")).toBeNull();
  });

  test("isWebAppHost recognizes localhost and private nets", () => {
    expect(isWebAppHost("localhost")).toBe(true);
    expect(isWebAppHost("127.0.0.1")).toBe(true);
    expect(isWebAppHost("10.0.0.5")).toBe(true);
    expect(isWebAppHost("app.onmyagentlabs.com")).toBe(true);
    expect(isWebAppHost("example.com")).toBe(false);
  });

  test("strip/ensure api/den path", () => {
    expect(stripDenApiBasePath("https://h.example/api/den")).toBe(
      "https://h.example",
    );
    expect(ensureDenApiBasePath("https://h.example")).toBe(
      "https://h.example/api/den",
    );
    expect(ensureDenApiBasePath("https://h.example/api/den")).toBe(
      "https://h.example/api/den",
    );
  });

  test("deriveDenApiBaseUrl adds /api/den for web app hosts", () => {
    expect(deriveDenApiBaseUrl("https://app.onmyagentlabs.com", "https://fallback")).toBe(
      "https://app.onmyagentlabs.com/api/den",
    );
  });

  test("resolveDenBaseUrls uses fallback seed", () => {
    const urls = resolveDenBaseUrls(null, "https://fallback.example");
    expect(urls.baseUrl).toBe("https://fallback.example");
    expect(urls.apiBaseUrl).toContain("fallback.example");
  });
});
