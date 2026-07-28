/** @jsxImportSource react */
import {
  createContext,
  useCallback,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ReloadReason, ReloadTrigger } from "../../app/types";
import { t } from "../../i18n";
import { TopRightNotifications } from "../domains/shell-feedback";
import { useSystemState } from "../kernel/system-state";

type ReloadSession = { id: string; title: string };

export type WorkspaceReloadControls = {
  canReloadWorkspaceEngine: () => boolean;
  reloadWorkspaceEngine: () => Promise<boolean>;
  activeSessions?: () => ReloadSession[];
  stopSession?: (sessionId: string) => void | Promise<void>;
};

type ReloadCoordinatorContextValue = {
  markReloadRequired: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
  clearReloadRequired: () => void;
  reloadWorkspaceEngine: () => Promise<void>;
  canReloadWorkspaceEngine: boolean;
  reloadPending: boolean;
  registerWorkspaceReloadControls: (controls: WorkspaceReloadControls | null) => () => void;
};

export const orgOnboardingVisibilityEvent = "onmyagent-org-onboarding-visibility";

const ReloadCoordinatorContext = createContext<ReloadCoordinatorContextValue | null>(null);

export function ReloadCoordinatorProvider({ children }: { children: ReactNode }) {
  const controlsRef = useRef<WorkspaceReloadControls | null>(null);
  const [activeSessions, setActiveSessions] = useState<ReloadSession[]>([]);
  const [orgOnboardingVisible, setOrgOnboardingVisible] = useState(false);

  const registerWorkspaceReloadControls = useCallback((controls: WorkspaceReloadControls | null) => {
    controlsRef.current = controls;
    setActiveSessions(controls?.activeSessions?.() ?? []);
    return () => {
      if (controlsRef.current === controls) {
        controlsRef.current = null;
        setActiveSessions([]);
      }
    };
  }, []);

  const hasActiveRuns = useCallback(() => activeSessions.length > 0, [activeSessions.length]);
  const canReloadWorkspaceEngine = useCallback(
    () => controlsRef.current?.canReloadWorkspaceEngine() === true,
    [],
  );
  const reloadWorkspaceEngine = useCallback(async () => {
    const controls = controlsRef.current;
    if (!controls?.reloadWorkspaceEngine) return false;
    return controls.reloadWorkspaceEngine();
  }, []);
  const ignoreError = useCallback(() => {}, []);

  const systemStateOptions = useMemo(
    () => ({
      hasActiveRuns,
      canReloadWorkspaceEngine,
      reloadWorkspaceEngine,
      setError: ignoreError,
    }),
    [canReloadWorkspaceEngine, hasActiveRuns, ignoreError, reloadWorkspaceEngine],
  );

  const systemState = useSystemState(systemStateOptions);

  useEffect(() => {
    const update = (event: Event) => {
      setOrgOnboardingVisible(Boolean((event as CustomEvent<{ visible?: boolean }>).detail?.visible));
    };
    window.addEventListener(orgOnboardingVisibilityEvent, update);
    return () => {
      window.removeEventListener(orgOnboardingVisibilityEvent, update);
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: ReloadReason; trigger?: ReloadTrigger }>).detail;
      systemState.markReloadRequired(detail?.reason ?? "config", detail?.trigger);
    };
    window.addEventListener("onmyagent-reload-required", handler);
    return () => window.removeEventListener("onmyagent-reload-required", handler);
  }, [systemState.markReloadRequired]);

  const forceStopActiveSessionsAndReload = useCallback(async () => {
    const controls = controlsRef.current;
    const stopSession = controls?.stopSession;
    if (stopSession) {
      await Promise.all(activeSessions.map((session) => Promise.resolve(stopSession(session.id)).catch(() => undefined)));
    }
    await systemState.reloadWorkspaceEngine();
  }, [activeSessions, systemState.reloadWorkspaceEngine]);

  const value = useMemo<ReloadCoordinatorContextValue>(
    () => ({
      markReloadRequired: systemState.markReloadRequired,
      clearReloadRequired: systemState.clearReloadRequired,
      reloadWorkspaceEngine: systemState.reloadWorkspaceEngine,
      canReloadWorkspaceEngine: systemState.canReloadWorkspaceEngine,
      reloadPending: systemState.reload.reloadPending,
      registerWorkspaceReloadControls,
    }),
    [
      registerWorkspaceReloadControls,
      systemState.canReloadWorkspaceEngine,
      systemState.clearReloadRequired,
      systemState.markReloadRequired,
      systemState.reload.reloadPending,
      systemState.reloadWorkspaceEngine,
    ],
  );

  return (
    <ReloadCoordinatorContext.Provider value={value}>
      {children}
      {/* Production mount: reload toast + status toasts (TopRightNotifications). */}
      <TopRightNotifications
        reloadOpen={
          systemState.reload.reloadPending &&
          activeSessions.length === 0 &&
          !orgOnboardingVisible
        }
        reloadTitle={systemState.reloadCopy.title}
        reloadDescription={systemState.reloadCopy.body}
        reloadTrigger={systemState.reload.reloadTrigger}
        reloadError={systemState.reload.reloadError}
        reloadLabel={
          activeSessions.length > 0 ? t("app.reload_stop_tasks") : t("app.reload_now")
        }
        dismissLabel={t("app.reload_later")}
        reloadBusy={systemState.reload.reloadBusy}
        canReload={systemState.canReloadWorkspaceEngine}
        hasActiveRuns={activeSessions.length > 0}
        onReload={() => {
          void (activeSessions.length > 0
            ? forceStopActiveSessionsAndReload()
            : systemState.reloadWorkspaceEngine());
        }}
        onDismissReload={systemState.clearReloadRequired}
      />
    </ReloadCoordinatorContext.Provider>
  );
}

export function useReloadCoordinator(): ReloadCoordinatorContextValue {
  const value = use(ReloadCoordinatorContext);
  if (!value) {
    throw new Error("useReloadCoordinator must be used inside <ReloadCoordinatorProvider>");
  }
  return value;
}
