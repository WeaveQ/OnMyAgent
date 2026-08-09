/**
 * Local simple-icons resolution — no network CDN at runtime.
 * Known slugs map to vendored SVGs under /simple-icons/; unknown slugs use a
 * monochrome offline fallback so UI never depends on an external icon host.
 */
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";

/** Slugs vendored under apps/app/public/simple-icons/<slug>.svg */
export const LOCAL_SIMPLE_ICON_SLUGS = [
  "apple",
  "googlesheets",
  "hackthebox",
  "linear",
  "medium",
  "notion",
  "semanticscholar",
  "semanticweb",
  "sentry",
  "stripe",
  "zapier",
] as const;

export type LocalSimpleIconSlug = (typeof LOCAL_SIMPLE_ICON_SLUGS)[number];

const LOCAL_SET = new Set<string>(LOCAL_SIMPLE_ICON_SLUGS);

/**
 * Resolve a simple-icons slug to a same-origin public asset URL.
 * Always offline-safe: unknown slugs map to the local fallback glyph.
 */
export function resolveSimpleIconUrl(slug: string): string {
  const key = String(slug ?? "")
    .trim()
    .toLowerCase();
  if (key && LOCAL_SET.has(key)) {
    return resolvePublicAssetUrl(`/simple-icons/${key}.svg`);
  }
  return resolvePublicAssetUrl("/simple-icons/_fallback.svg");
}

export function isLocalSimpleIconSlug(slug: string): boolean {
  return LOCAL_SET.has(String(slug ?? "").trim().toLowerCase());
}
