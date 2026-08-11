export function resolvePublicAssetUrl(path: string): string {
  if (!path.startsWith("/")) {
    return path;
  }
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}${path.replace(/^\/+/, "")}`;
}

/**
 * Resolve a public asset to an absolute URL.
 *
 * Use this for URLs consumed from within an external stylesheet (e.g. a CSS
 * `mask-image` custom property set as an inline style but referenced by a
 * Tailwind utility class shipped in `assets/*.css`). A relative `url(...)`
 * there resolves against the stylesheet's own location (`/assets/`), not the
 * document, so `"./illustrations/x.svg"` would 404 as `/assets/illustrations/
 * x.svg` in packaged (`file://`) builds. An absolute URL resolves identically
 * regardless of where the referencing stylesheet lives.
 */
export function resolvePublicAssetAbsoluteUrl(path: string): string {
  const relative = resolvePublicAssetUrl(path);
  if (typeof document === "undefined" || /^[a-z]+:\/\//i.test(relative)) {
    return relative;
  }
  return new URL(relative, document.baseURI).href;
}
