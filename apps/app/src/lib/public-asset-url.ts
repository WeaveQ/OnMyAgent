export function resolvePublicAssetUrl(path: string): string {
  if (!path.startsWith("/")) {
    return path;
  }
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}${path.replace(/^\/+/, "")}`;
}
