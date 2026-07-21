/** @jsxImportSource react */
import type { LucideIcon } from "lucide-react";
import {
  AppWindow,
  ImageIcon,
  Mic,
  Plug,
} from "lucide-react";

import type { McpDirectoryInfo } from "@/app/constants";
import { resolveExtensionIconSrc } from "@/react-app/design-system/extension-icon-src";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import { cn } from "@/lib/utils";

/**
 * Built-in product extensions: prefer the same semantic Lucide / ProviderIcon
 * language used elsewhere in the shell (model picker, rail, settings cards)
 * instead of shared logo PNGs that read poorly at 16px / dark mode.
 */
const BUILTIN_LUCIDE_BY_ID: Record<string, LucideIcon> = {
  "computer-use": AppWindow,
  "onmyagent-voice": Mic,
  "openai-image-gen": ImageIcon,
};

const BUILTIN_PROVIDER_ID_BY_EXT: Record<string, string> = {
  ollama: "ollama",
  "openai-image-gen": "openai",
};

/** Dark ink on the white icon plate (must beat IconTile tone text utilities). */
const ICON_INK = "text-neutral-900";

function extensionKey(entry: Pick<McpDirectoryInfo, "id" | "serverName" | "name">) {
  return (entry.id ?? entry.serverName ?? entry.name).trim().toLowerCase();
}

/**
 * Shared icon renderer for built-in / catalog extensions (composer + plugins market).
 * Icons are drawn for a **white** tile — always use dark strokes (no dark:invert).
 */
export function extensionIcon(entry: McpDirectoryInfo, size = 16) {
  const key = extensionKey(entry);
  const providerId = BUILTIN_PROVIDER_ID_BY_EXT[key];
  const Lucide = BUILTIN_LUCIDE_BY_ID[key];

  // Brand providers (OpenAI / Ollama): system ProviderIcon (same as model picker).
  if (providerId && !Lucide) {
    return (
      <ProviderIcon
        providerId={providerId}
        size={size}
        className={ICON_INK}
      />
    );
  }

  // Product features with a clear system glyph (Computer Use, Voice, Image).
  if (Lucide) {
    return <Lucide size={size} className={cn(ICON_INK, "shrink-0")} strokeWidth={2} />;
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
        src={`https://cdn.simpleicons.org/${entry.iconSlug}`}
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
 */
export const extensionIconTileClassName = cn(
  "border-dls-border/80 !bg-white dark:!bg-white",
  "!text-neutral-900 dark:!text-neutral-900",
  "[&_svg]:!text-neutral-900 [&_svg]:!stroke-neutral-900",
);
