/** @jsxImportSource react */
import { Plug } from "lucide-react";

import type { McpDirectoryInfo } from "@/app/constants";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";

/** Shared icon renderer for built-in / catalog extensions (composer + plugins market). */
export function extensionIcon(entry: McpDirectoryInfo, size = 16) {
  if (entry.iconSrc) {
    return (
      <img
        src={resolvePublicAssetUrl(entry.iconSrc)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="block"
      />
    );
  }
  if (entry.iconSlug) {
    return (
      <img
        src={`https://cdn.simpleicons.org/${entry.iconSlug}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="block"
      />
    );
  }
  return <Plug size={size} className="text-dls-secondary" />;
}
