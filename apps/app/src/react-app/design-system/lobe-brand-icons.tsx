/** @jsxImportSource react */
/**
 * Lobe brand marks via static SVG CDN (Aliyun npmmirror).
 * Mapping tables live in `lobe-provider-key.ts` for pure unit tests.
 *
 * No `@lobehub/icons` package import — that pulls antd/@lobehub/ui peers and
 * is not a workspace dependency. Static SVG URLs keep the shell light.
 */
import { useState, memo } from "react";

import {
  lobeStaticSvgUrl,
  resolveLobeAgentIconId,
  resolveLobePluginIconId,
  resolveLobeProviderKey,
} from "./lobe-provider-key";

export {
  lobeStaticSvgUrl,
  resolveLobeAgentIconId,
  resolveLobePluginIconId,
  resolveLobeProviderKey,
} from "./lobe-provider-key";

function StaticBrandImg(props: {
  iconId: string;
  variant: "mono" | "color";
  size: number;
  className?: string;
  onFailed?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    props.onFailed?.();
    return null;
  }
  return (
    <img
      src={lobeStaticSvgUrl(props.iconId, props.variant)}
      alt=""
      width={props.size}
      height={props.size}
      className={props.className}
      loading="lazy"
      draggable={false}
      onError={() => {
        setFailed(true);
        props.onFailed?.();
      }}
    />
  );
}

/** Model-provider mark (prefer mono for themeable UI chrome). */
export const LobeProviderBrandIcon = memo(function LobeProviderBrandIcon(props: {
  providerId?: string | null;
  providerName?: string | null;
  size?: number;
  className?: string;
  onFailed?: () => void;
}) {
  const key = resolveLobeProviderKey(props.providerId, props.providerName);
  if (!key) {
    props.onFailed?.();
    return null;
  }
  return (
    <StaticBrandImg
      iconId={key}
      variant="mono"
      size={props.size ?? 16}
      className={props.className}
      onFailed={props.onFailed}
    />
  );
});

/** Local-agent tile mark (prefer color on white plate). */
export const LobeAgentBrandIcon = memo(function LobeAgentBrandIcon(props: {
  id?: string | null;
  provider?: string | null;
  size?: number;
  className?: string;
}) {
  const iconId = resolveLobeAgentIconId(props.id, props.provider);
  if (!iconId) return null;
  return (
    <StaticBrandImg
      iconId={iconId}
      variant="color"
      size={props.size ?? 24}
      className={props.className}
    />
  );
});

/** Plugin / connector preview mark. */
export const LobePluginBrandIcon = memo(function LobePluginBrandIcon(props: {
  iconKey?: string | null;
  size?: number;
  className?: string;
  onFailed?: () => void;
}) {
  const iconId = resolveLobePluginIconId(props.iconKey);
  if (!iconId) {
    props.onFailed?.();
    return null;
  }
  return (
    <StaticBrandImg
      iconId={iconId}
      variant="color"
      size={props.size ?? 24}
      className={props.className}
      onFailed={props.onFailed}
    />
  );
});

export function hasLobeProviderIcon(
  providerId?: string | null,
  providerName?: string | null,
): boolean {
  return Boolean(resolveLobeProviderKey(providerId, providerName));
}

export function hasLobeAgentBrandIcon(id?: string | null, provider?: string | null): boolean {
  return Boolean(resolveLobeAgentIconId(id, provider));
}

export function hasLobePluginBrandIcon(iconKey?: string | null): boolean {
  return Boolean(resolveLobePluginIconId(iconKey));
}
