/** @jsxImportSource react */
import { useCallback, useEffect, useReducer, type ReactNode } from "react";

import { isDesktopRuntime } from "../../app/utils";
import { Button } from "@/components/ui/button";
import { useBootState } from "./boot-state";
import { APP_NAME } from "../../i18n/locales/brand";

type ArchitectureInfo = {
  appArch: string;
  appArchLabel: string;
  systemArch: string;
  systemArchLabel: string;
  mismatch: boolean;
  platform: "darwin" | "linux" | "windows";
  version: string;
  downloadUrl: string;
  releaseUrl: string;
};

type ArchitectureMismatchGateProps = {
  children: ReactNode;
};

type ArchitectureGateState = {
  info: ArchitectureInfo | null;
  checked: boolean;
};

type ArchitectureGateAction =
  | { type: "checked" }
  | { type: "resolved"; info: ArchitectureInfo };

function architectureGateReducer(
  state: ArchitectureGateState,
  action: ArchitectureGateAction,
): ArchitectureGateState {
  switch (action.type) {
    case "checked":
      return { ...state, checked: true };
    case "resolved":
      return { info: action.info, checked: true };
  }
}

function platformLabel(platform: ArchitectureInfo["platform"]): string {
  if (platform === "darwin") return "macOS";
  if (platform === "windows") return "Windows";
  return "Linux";
}

const architectureGateClass = {
  root: "min-h-screen bg-dls-shell-dark text-white",
  container: "mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-12",
  panel: "w-full overflow-hidden rounded-xl border border-dls-surface/10 bg-dls-surface",
  grid: "grid gap-0 lg:grid-cols-[1.05fr_0.95fr]",
  content: "space-y-8 p-8 sm:p-10 lg:p-12",
  intro: "space-y-4",
  compareGrid: "grid gap-3 sm:grid-cols-2",
  appCard: "rounded-xl border border-dls-surface/10 bg-black/20 p-4",
  actions: "flex flex-col gap-3 sm:flex-row",
  eyebrow: "text-xs font-medium text-dls-status-warning",
  eyebrowBadge: "inline-flex rounded-full border border-dls-status-warning-border bg-dls-status-warning-soft px-3 py-1",
  heroTitle: "max-w-2xl text-2xl font-medium tracking-tight text-white sm:text-3xl",
  heroDescription: "max-w-2xl text-sm leading-6 text-white/72",
  compareLabel: "text-xs font-medium text-white/45",
  compareValue: "mt-2 text-base font-medium text-white",
  compareCode: "mt-1 font-mono text-xs text-white/45",
  systemCard: "rounded-xl border border-dls-status-success-border bg-dls-status-success-soft p-4",
  systemLabel: "text-xs font-medium text-dls-status-success-fg/70",
  systemValue: "mt-2 text-base font-medium text-dls-status-success-fg",
  systemCode: "mt-1 font-mono text-xs text-dls-status-success-fg/55",
  downloadButton: "rounded-lg bg-white text-black hover:bg-dls-status-success-soft",
  releaseButton: "rounded-lg border-dls-surface/14 bg-transparent text-white/85 hover:bg-white/10 hover:text-white",
  aside: "border-t border-dls-surface/10 bg-gradient-to-br from-dls-status-success-soft/20 via-dls-accent/10 to-transparent p-8 sm:p-10 lg:border-l lg:border-t-0 lg:p-12",
  asideBody: "space-y-5 rounded-xl border border-dls-surface/10 bg-black/25 p-6 text-sm leading-6 text-white/68",
  asideTitle: "text-base font-medium text-white",
  asideCode: "rounded-xl bg-dls-surface p-4 font-mono text-xs text-white/55",
};

export function ArchitectureMismatchGate({
  children,
}: ArchitectureMismatchGateProps) {
  const { markRouteReady } = useBootState();
  const [state, dispatch] = useReducer(architectureGateReducer, {
    info: null,
    checked: !isDesktopRuntime(),
  });
  const { info, checked } = state;

  useEffect(() => {
    let cancelled = false;
    const bridge = window.__ONMYAGENT_ELECTRON__?.system?.getArchitectureInfo;
    if (!bridge) {
      dispatch({ type: "checked" });
      return;
    }

    void bridge()
      .then((nextInfo) => {
        if (cancelled) return;
        dispatch({ type: "resolved", info: nextInfo });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn(
          "[architecture-gate] failed to resolve runtime architecture",
          error,
        );
        dispatch({ type: "checked" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (info?.mismatch) markRouteReady();
  }, [info?.mismatch, markRouteReady]);

  const openDownload = useCallback(() => {
    const url = info?.downloadUrl || info?.releaseUrl;
    if (!url) return;
    void window.__ONMYAGENT_ELECTRON__?.shell?.openExternal?.(url);
  }, [info?.downloadUrl, info?.releaseUrl]);

  const openRelease = useCallback(() => {
    if (!info?.releaseUrl) return;
    void window.__ONMYAGENT_ELECTRON__?.shell?.openExternal?.(info.releaseUrl);
  }, [info?.releaseUrl]);

  if (!checked) return null;
  if (!info?.mismatch) return <>{children}</>;

  return (
    <main className={architectureGateClass.root}>
      <div className={architectureGateClass.container}>
        <section className={architectureGateClass.panel}>
          <div className={architectureGateClass.grid}>
            <div className={architectureGateClass.content}>
              <div className={`${architectureGateClass.eyebrowBadge} ${architectureGateClass.eyebrow}`}>
                Architecture mismatch
              </div>
              <div className={architectureGateClass.intro}>
                <h1 className={architectureGateClass.heroTitle}>
                  Install the correct {APP_NAME} build
                </h1>
                <p className={architectureGateClass.heroDescription}>
                  Your application is running the {info.appArchLabel} version of
                  {APP_NAME}, but this {platformLabel(info.platform)} system is{" "}
                  {info.systemArchLabel}. This may cause unpredictable issues.
                </p>
              </div>

              <div className={architectureGateClass.compareGrid}>
                <div className={architectureGateClass.appCard}>
                  <div className={architectureGateClass.compareLabel}>
                    Running app
                  </div>
                  <div className={architectureGateClass.compareValue}>
                    {info.appArchLabel}
                  </div>
                  <div className={architectureGateClass.compareCode}>
                    {info.appArch}
                  </div>
                </div>
                <div className={architectureGateClass.systemCard}>
                  <div className={architectureGateClass.systemLabel}>
                    Your system
                  </div>
                  <div className={architectureGateClass.systemValue}>
                    {info.systemArchLabel}
                  </div>
                  <div className={architectureGateClass.systemCode}>
                    {info.systemArch}
                  </div>
                </div>
              </div>

              <div className={architectureGateClass.actions}>
                <Button
                  type="button"
                  onClick={openDownload}
                  size="lg"
                  className={architectureGateClass.downloadButton}
                >
                  Download correct version
                </Button>
                <Button
                  type="button"
                  onClick={openRelease}
                  variant="outline"
                  size="lg"
                  className={architectureGateClass.releaseButton}
                >
                  Open release page
                </Button>
              </div>
            </div>

            <aside className={architectureGateClass.aside}>
              <div className={architectureGateClass.asideBody}>
                <div className={architectureGateClass.asideTitle}>
                  Why {APP_NAME} stopped here
                </div>
                <p>
                  {APP_NAME} blocks startup when the installed app architecture
                  does not match the machine architecture. This prevents runtime
                  sidecars, browser tooling, and update downloads from
                  continuing on the wrong build.
                </p>
                <p>
                  After installing the correct {info.systemArchLabel} build,
                  quit this copy and launch {APP_NAME} again. Your workspaces
                  and settings are kept in the same app data folder.
                </p>
                <div className={architectureGateClass.asideCode}>
                  v{info.version} · {platformLabel(info.platform)} ·{" "}
                  {info.systemArch}
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
