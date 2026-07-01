export const deepLinkBridgeEvent = "onmyagent:deep-link";
export const nativeDeepLinkEvent = "onmyagent:deep-link-native";

export type DeepLinkBridgeDetail = {
  urls: string[];
};

declare global {
  interface Window {
    __ONMYAGENT__?: {
      deepLinks?: string[];
    };
  }
}

function normalizeDeepLinks(urls: readonly string[]): string[] {
  return urls.flatMap((url) => {
    const trimmed = url.trim();
    return trimmed ? [trimmed] : [];
  });
}

export function pushPendingDeepLinks(target: Window, urls: readonly string[]): string[] {
  const normalized = normalizeDeepLinks(urls);
  if (normalized.length === 0) {
    return [];
  }

  target.__ONMYAGENT__ ??= {};
  const pending = target.__ONMYAGENT__.deepLinks ?? [];
  target.__ONMYAGENT__.deepLinks = [...pending, ...normalized];
  target.dispatchEvent(
    new CustomEvent<DeepLinkBridgeDetail>(deepLinkBridgeEvent, {
      detail: { urls: normalized },
    }),
  );
  return normalized;
}

export function drainPendingDeepLinks(target: Window): string[] {
  const pending = target.__ONMYAGENT__?.deepLinks ?? [];
  if (target.__ONMYAGENT__) {
    target.__ONMYAGENT__.deepLinks = [];
  }
  return [...pending];
}
