/** @jsxImportSource react */
import { useEffect } from "react";
import { t } from "../../i18n";

import {
  engineInfo,
  engineStart,
  onmyagentServerInfo,
  onmyagentServerRestart,
  resolveWorkspaceListSelectedId,
  runtimeBootstrap,
  workspaceBootstrap,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  type EngineInfo,
  type OnMyAgentServerInfo,
  type WorkspaceInfo,
  type WorkspaceList,
} from "../../app/lib/desktop";
import { ingestMigrationSnapshotOnElectronBoot } from "../../app/lib/migration";
import {
  hydrateOnMyAgentServerSettingsFromEnv,
  readOnMyAgentServerSettings,
  writeOnMyAgentServerSettings,
} from "../../app/lib/onmyagent-server";
import { isDesktopRuntime, isElectronRuntime, safeStringify } from "../../app/utils";
import { useServer } from "../kernel/server-provider";
import { useBootState, userFacingBootError } from "./boot-state";
import { beginLoadScope } from "./route-load-registry";

// Module-scoped latch so React Strict-Mode's "mount-unmount-remount" cycle in
// dev only triggers the boot sequence once per app launch, and the async work
// keeps running across the transient unmount.
let BOOT_STARTED = false;

type BootOnMyAgentServerInfo = {
  running?: boolean | null;
  baseUrl?: string | null;
  ownerToken?: string | null;
  clientToken?: string | null;
  hostToken?: string | null;
  port?: number | null;
  remoteAccessEnabled?: boolean;
};

function isOnMyAgentServerInfoLike(info: unknown): info is BootOnMyAgentServerInfo {
  return typeof info === "object" && info !== null;
}

function isOnMyAgentServerReady(info?: BootOnMyAgentServerInfo) {
  return Boolean(
    info?.running === true &&
      info.baseUrl?.trim() &&
      (info.ownerToken?.trim() || info.clientToken?.trim()),
  );
}

/**
 * On desktop (Electron) startup:
 *   1) bootstrap the workspace list
 *   2) if a local workspace is selected, restart the embedded OnMyAgent server
 *   3) start the OpenCode engine pointed at the workspace
 *   4) activate the workspace on the running OnMyAgent server
 *   5) notify React routes that fresh desktop runtime info is available. Electron
 *      routes read live runtime info directly instead of persisting ephemeral
 *      localhost ports/tokens into OnMyAgent settings.
 *
 * Safe to call multiple times — gated by a `didBoot` ref so it runs once per mount.
 */
export function useDesktopRuntimeBoot() {
  const { setPhase, setError, markReady } = useBootState();
  const { setActive } = useServer();

  useEffect(() => {
    if (!isDesktopRuntime()) {
      // Web/headless: nothing to spawn, we're instantly "ready".
      markReady();
      return;
    }
    if (BOOT_STARTED) return;
    BOOT_STARTED = true;
    const endDesktopBootScope = beginLoadScope("desktop-boot");

    void (async () => {
      try {
        // On Electron specifically: if the previous desktop install (Tauri)
        // dropped a migration snapshot, fold it into localStorage before any of
        // the boot code reads workspace preferences. Idempotent across
        // launches (the helper only writes keys that are still empty
        // and acks the file after ingestion).
        if (isElectronRuntime()) {
          const hydrated = await ingestMigrationSnapshotOnElectronBoot();
          if (hydrated > 0) {
            // eslint-disable-next-line no-console -- valuable one-time signal
            console.info(`[migration] hydrated ${hydrated} localStorage keys from legacy desktop snapshot`);
          }
        }
        hydrateOnMyAgentServerSettingsFromEnv();
        const preferredRemoteAccess = readOnMyAgentServerSettings().remoteAccessEnabled === true;

        setPhase("bootstrapping-workspaces");
        // P1: parallel critical path —
        // - workspace list (always)
        // - Electron: shared main-process runtimeBootstrap (idempotent promise)
        // - non-Electron: cheap engineInfo probe for attach-if-running
        const listPromise = workspaceBootstrap().catch(() => null) as Promise<WorkspaceList | null>;
        type ElectronBootResult = {
          ok?: boolean;
          skipped?: boolean;
          error?: string;
          engine?: { baseUrl?: string | null };
          onmyagentServer?: BootOnMyAgentServerInfo;
        };
        const electronRuntimePromise = isElectronRuntime()
          ? (runtimeBootstrap().catch((error) => ({
              ok: false,
              error: error instanceof Error ? error.message : safeStringify(error),
            })) as Promise<ElectronBootResult>)
          : null;
        const engineProbePromise = isElectronRuntime()
          ? Promise.resolve(null as EngineInfo | null)
          : (engineInfo().catch(() => null) as Promise<EngineInfo | null>);

        const list = await listPromise;
        if (!list) {
          markReady();
          return;
        }

        const selectedId = resolveWorkspaceListSelectedId(list);
        const workspace = selectedId
          ? list.workspaces.find((w) => w.id === selectedId)
          : undefined;
        if (!workspace || workspace.workspaceType === "remote") {
          markReady();
          return;
        }

        const workspaceRoot = workspace.path?.trim();
        if (!workspaceRoot) {
          markReady();
          return;
        }

        if (isElectronRuntime() && electronRuntimePromise) {
          setPhase("starting-engine", t("system.starting_workspace"));
          // Yield one frame so the solid boot overlay can paint before we
          // block on the (already in-flight) runtime bootstrap result.
          await Promise.resolve();
          const boot = await electronRuntimePromise;

          if (boot.ok === false) {
            const friendly = userFacingBootError(
              boot.error,
              "system.boot_start_runtime_failed",
            );
            setError(friendly.message, friendly.technicalDetail);
            return;
          }

          if (!boot.skipped && !isOnMyAgentServerReady(boot.onmyagentServer)) {
            setError(t("system.boot_server_not_ready"));
            return;
          }

          if (boot.engine?.baseUrl) {
            setActive(boot.engine.baseUrl);
          }
          let serverInfo = boot.onmyagentServer;
          if (preferredRemoteAccess && serverInfo?.remoteAccessEnabled !== true) {
            const restarted = await onmyagentServerRestart({ remoteAccessEnabled: true }).catch((error) => {
              console.warn("[desktop-boot] onmyagentServerRestart failed:", error);
              return null;
            });
            if (isOnMyAgentServerInfoLike(restarted)) serverInfo = restarted;
          }
          if (serverInfo?.baseUrl) {
            writeOnMyAgentServerSettings({
              urlOverride: serverInfo.baseUrl,
              token:
                serverInfo.ownerToken?.trim() ||
                serverInfo.clientToken?.trim() ||
                undefined,
              hostToken: serverInfo.hostToken?.trim() || undefined,
              portOverride: serverInfo.port ?? undefined,
              remoteAccessEnabled: serverInfo.remoteAccessEnabled === true,
            });
            try {
              window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
            } catch {
              /* ignore */
            }
          }
          markReady();
          return;
        }

        // FAST PATH ─────────────────────────────────────────────────────
        // Cheap status probe (started in parallel with workspaceBootstrap):
        // if engine is already running, attach and finish without engineStart.
        try {
          const engine = await engineProbePromise;
          if (engine?.running && engine.baseUrl) {
            setActive(engine.baseUrl);
            const fresh = await onmyagentServerInfo().catch(() => null) as OnMyAgentServerInfo | null;
            if (fresh?.baseUrl) {
              writeOnMyAgentServerSettings({
                urlOverride: fresh.baseUrl,
                token:
                  fresh.ownerToken?.trim() ||
                  fresh.clientToken?.trim() ||
                  undefined,
                hostToken: fresh.hostToken?.trim() || undefined,
                portOverride: fresh.port ?? undefined,
                remoteAccessEnabled: fresh.remoteAccessEnabled === true,
              });
              try {
                window.dispatchEvent(
                  new CustomEvent("onmyagent-server-settings-changed"),
                );
              } catch {
                /* ignore */
              }
            }
            markReady();
            return;
          }
        } catch {
          // engineInfo is best-effort; fall through to the slow path.
        }

        // SLOW PATH ─────────────────────────────────────────────────────
        // No running engine. The desktop shell mirrors Electron: engine_start boots
        // onmyagent-server and lets that server manage OpenCode.
        const localPaths = list.workspaces.flatMap((entry: WorkspaceInfo) => {
          const path = entry.workspaceType !== "remote" ? entry.path?.trim() ?? "" : "";
          return path ? [path] : [];
        });
        const workspacePathsFor = (root: string) => {
          const paths = [root];
          const pathSet = new Set(paths);
          for (const path of localPaths) {
            if (pathSet.has(path)) continue;
            paths.push(path);
            pathSet.add(path);
          }
          return paths;
        };

        setPhase("starting-engine", t("system.starting_workspace"));
        let engineStartResult = await engineStart(workspaceRoot, {
          runtime: "direct",
          workspacePaths: workspacePathsFor(workspaceRoot),
          onmyagentRemoteAccess: readOnMyAgentServerSettings().remoteAccessEnabled === true,
        }).catch((error) => {
          console.warn("[desktop-boot] engineStart failed:", error);
          return null;
        }) as EngineInfo | null;

        if (!engineStartResult) {
          const fallback = list.workspaces.find((entry) => {
            const path = entry.path?.trim() ?? "";
            return entry.workspaceType !== "remote" && path && path !== workspaceRoot;
          });
          const fallbackRoot = fallback?.path?.trim() ?? "";
          if (fallback && fallbackRoot) {
            console.warn("[desktop-boot] selected workspace failed; trying fallback workspace", {
              selectedWorkspaceId: workspace.id,
              fallbackWorkspaceId: fallback.id,
            });
            setPhase("starting-engine", t("system.starting_another_workspace"));
            engineStartResult = await engineStart(fallbackRoot, {
              runtime: "direct",
              workspacePaths: workspacePathsFor(fallbackRoot).filter((path) => path !== workspaceRoot),
              onmyagentRemoteAccess: readOnMyAgentServerSettings().remoteAccessEnabled === true,
            }).catch((error) => {
              console.warn("[desktop-boot] fallback engineStart failed:", error);
              const friendly = userFacingBootError(
                error,
                "system.start_workspace_failed",
              );
              setError(friendly.message, friendly.technicalDetail);
              return null;
            }) as EngineInfo | null;
            if (engineStartResult) {
              void workspaceSetSelected(fallback.id).catch(() => undefined);
              void workspaceSetRuntimeActive(fallback.id).catch(() => undefined);
            }
          } else {
            setError(t("system.start_workspace_failed"));
          }
        }

        if (engineStartResult) {
          if (engineStartResult.baseUrl) {
            setActive(engineStartResult.baseUrl);
          }
          try {
            const freshInfo = await onmyagentServerInfo() as OnMyAgentServerInfo | null;
            if (freshInfo?.baseUrl) {
              writeOnMyAgentServerSettings({
                urlOverride: freshInfo.baseUrl,
                token:
                  freshInfo.ownerToken?.trim() ||
                  freshInfo.clientToken?.trim() ||
                  undefined,
                hostToken: freshInfo.hostToken?.trim() || undefined,
                portOverride: freshInfo.port ?? undefined,
                remoteAccessEnabled: freshInfo.remoteAccessEnabled === true,
              });
              try {
                window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
              } catch {
                /* ignore */
              }
            }
          } catch (error) {
            console.warn("[desktop-boot] post-engineStart onmyagentServerInfo failed:", error);
          }
        }

        markReady();
      } catch (error) {
        console.warn("[desktop-boot] fatal:", error);
        const friendly = userFacingBootError(
          error,
          "system.boot_start_runtime_failed",
        );
        setError(friendly.message, friendly.technicalDetail);
      } finally {
        endDesktopBootScope();
      }
    })();
  }, [markReady, setActive, setError, setPhase]);
}

/**
 * Component wrapper that must be rendered inside <BootStateProvider>. It runs
 * the boot hook exactly once per app mount so callers don't have to think
 * about React Strict-Mode double-invocation.
 */
export function DesktopRuntimeBoot(): null {
  useDesktopRuntimeBoot();
  return null;
}
