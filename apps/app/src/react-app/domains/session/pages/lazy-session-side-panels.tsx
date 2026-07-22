/** @jsxImportSource react */
/**
 * Heavy right-rail panels — code-split so the session primary path does not
 * pay for voice / canvas / code-workspace until the pane is opened.
 */
import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";

const VoicePanel = lazy(() =>
  import("../voice/voice-panel").then((module) => ({
    default: module.VoicePanel,
  })),
);

const CodeWorkspaceSidePanel = lazy(() =>
  import("../surface/code-workspace-side-panel").then((module) => ({
    default: module.CodeWorkspaceSidePanel,
  })),
);

const InfiniteCanvasPanel = lazy(() =>
  import("../infinite-canvas").then((module) => ({
    default: module.InfiniteCanvasPanel,
  })),
);

function SidePanelFallback() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-dls-surface text-xs text-dls-secondary">
      …
    </div>
  );
}

export function LazyVoicePanel(
  props: ComponentProps<typeof VoicePanel>,
) {
  return (
    <Suspense fallback={<SidePanelFallback />}>
      <VoicePanel {...props} />
    </Suspense>
  );
}

export function LazyCodeWorkspaceSidePanel(
  props: ComponentProps<typeof CodeWorkspaceSidePanel>,
) {
  return (
    <Suspense fallback={<SidePanelFallback />}>
      <CodeWorkspaceSidePanel {...props} />
    </Suspense>
  );
}

export function LazyInfiniteCanvasPanel(
  props: ComponentProps<typeof InfiniteCanvasPanel>,
) {
  return (
    <Suspense fallback={<SidePanelFallback />}>
      <InfiniteCanvasPanel {...props} />
    </Suspense>
  );
}

export type LazySidePanelSlot = ReactNode;
