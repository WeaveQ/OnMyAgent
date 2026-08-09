/** @jsxImportSource react */
import { Plug } from "lucide-react";

import type { McpDirectoryInfo } from "@/app/constants";
import { resolveExtensionIconSrc } from "@/react-app/design-system/extension-icon-src";
import { BUILTIN_PLUGIN_ICON_PNG_BY_ID } from "@/react-app/design-system/koboyo-product-icons";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import { resolveSimpleIconUrl } from "@/react-app/design-system/simple-icon";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

/** Brand logos (model picker language) for vendor-tied extensions. */
const BUILTIN_PROVIDER_ID_BY_EXT: Record<string, string> = {
  ollama: "ollama",
  "openai-image-gen": "openai",
};

/** Dark ink on light plates (market tiles + setup logo). */
const ICON_INK = "text-neutral-900";

function extensionKey(entry: Pick<McpDirectoryInfo, "id" | "serverName" | "name">) {
  return (entry.id ?? entry.serverName ?? entry.name).trim().toLowerCase();
}

/**
 * Shared icon renderer for built-in / catalog extensions (composer + plugins market).
 * Full-color PNG app marks for product builtins; brand ProviderIcon when mapped.
 */
export function extensionIcon(entry: McpDirectoryInfo, size = 16) {
  const key = extensionKey(entry);
  const providerId = BUILTIN_PROVIDER_ID_BY_EXT[key];
  const pngSrc = BUILTIN_PLUGIN_ICON_PNG_BY_ID[key];

  // Brand first (OpenAI Image Gen / Ollama) so product cards match model picker.
  if (providerId) {
    return (
      <ProviderIcon
        providerId={providerId}
        size={size}
        className={ICON_INK}
      />
    );
  }

  // Soft-UI product icons (computer-use, browser-skill, …).
  if (pngSrc) {
    return (
      <img
        src={resolvePublicAssetUrl(pngSrc)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="block rounded-md object-cover"
      />
    );
  }

  // Explicit catalog assets (Notion, Linear, monochrome SVGs, logos).
  if (entry.iconSrc) {
    const src = resolveExtensionIconSrc(entry.iconSrc);
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        // Stay black on white plate — never invert for dark theme.
        className="block object-contain"
      />
    );
  }

  if (entry.iconSlug) {
    return (
      <img
        src={resolveSimpleIconUrl(entry.iconSlug)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="block object-contain"
      />
    );
  }

  return <Plug size={size} className={cn(ICON_INK, "shrink-0")} strokeWidth={2} />;
}

/**
 * White plate + forced dark ink. IconTile tones set light text in dark mode;
 * !text-* wins so Lucide currentColor stays dark on the white chip.
 * Full-color PNGs sit on the plate without invert.
 */
export const extensionIconTileClassName = cn(
  "border-dls-border/80 !bg-white dark:!bg-white",
  "!text-neutral-900 dark:!text-neutral-900",
  "[&_svg]:!text-neutral-900 [&_svg]:!stroke-neutral-900",
  "overflow-hidden",
);
