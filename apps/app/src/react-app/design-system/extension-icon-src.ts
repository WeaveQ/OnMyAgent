import { resolvePublicAssetUrl } from "@/lib/public-asset-url";

export function resolveExtensionIconSrc(iconSrc: string): string {
  return resolvePublicAssetUrl(iconSrc);
}
