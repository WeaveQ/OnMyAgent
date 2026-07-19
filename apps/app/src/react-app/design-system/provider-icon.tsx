/** @jsxImportSource react */
import { useState } from "react";

import {
  hasLobeProviderIcon,
  LobeProviderBrandIcon,
} from "./lobe-brand-icons";

export type ProviderIconProps = {
  providerId?: string | null;
  /**
   * Optional provider display name. When the id is an opaque cloud id
   * (e.g. a uuid), the name is what tells us whether it's an Anthropic /
   * OpenAI / OpenCode provider. Ported from dev 022b68a8 ("key cloud
   * providers by cloud id") so the icon still resolves by family.
   */
  providerName?: string | null;
  className?: string;
  size?: number;
};

export function ProviderIcon(props: ProviderIconProps) {
  const size = props.size ?? 16;
  const [remoteFailed, setRemoteFailed] = useState(false);
  const normalizedId = props.providerId?.trim().toLowerCase() ?? "";

  const fallbackLetters = (() => {
    if (normalizedId === "openrouter") return "OR";
    if (normalizedId === "deepseek") return "DS";
    if (normalizedId === "google") return "GO";
    if (normalizedId.length >= 2) return normalizedId.substring(0, 2).toUpperCase();
    return "AI";
  })();

  const useLobe =
    !remoteFailed && hasLobeProviderIcon(props.providerId, props.providerName);

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-md ${
        props.className ?? ""
      }`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      {useLobe ? (
        <LobeProviderBrandIcon
          providerId={props.providerId}
          providerName={props.providerName}
          size={size}
          className="size-full object-contain"
          onFailed={() => setRemoteFailed(true)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded bg-dls-hover text-xs font-medium text-dls-secondary"
          style={{ fontSize: `${Math.max(8, size * 0.45)}px` }}
        >
          {fallbackLetters}
        </div>
      )}
    </div>
  );
}
