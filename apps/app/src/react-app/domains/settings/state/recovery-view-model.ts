/** @jsxImportSource react */
import { useCallback, useMemo, useState } from "react";

import { relaunchDesktopApp, resetOnMyAgentState } from "../../../../app/lib/desktop";
import type { ResetOnMyAgentMode } from "../../../../app/types";
import {
  addOpencodeCacheHint,
  isDesktopRuntime,
  safeStringify,
} from "../../../../app/utils";
import { t } from "../../../../i18n";
import { matchesResetConfirmation } from "../modals/reset-modal";
import type { RecoveryViewProps } from "../pages/recovery-view";
import {
  clearLocalStorageForOnMyAgentReset,
  softReenterWelcomeGuide,
} from "../../../kernel/reset-local-storage";

type UseRecoveryViewModelOptions = {
  anyActiveRuns: boolean;
  setRouteError?: (value: string | null) => void;
};

export function useRecoveryViewModel(
  options: UseRecoveryViewModelOptions,
): RecoveryViewProps {
  const { anyActiveRuns, setRouteError } = options;

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetModalMode, setResetModalMode] =
    useState<ResetOnMyAgentMode>("onboarding");
  const [resetModalText, setResetModalText] = useState("");
  const [resetModalBusy, setResetModalBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-enter onboarding: one-click confirm (no typed phrase).
  // Full app-data wipe still requires typing the confirmation word.
  const canReset =
    !resetModalBusy &&
    !anyActiveRuns &&
    (resetModalMode === "onboarding" ||
      matchesResetConfirmation(resetModalText));

  const onOpenResetModal = useCallback(
    (mode: ResetOnMyAgentMode) => {
      if (anyActiveRuns) {
        const message = t("system.stop_active_runs_before_reset");
        setError(message);
        setRouteError?.(message);
        return;
      }
      setError(null);
      setStatus(null);
      setRouteError?.(null);
      setResetModalMode(mode);
      setResetModalText("");
      setResetModalOpen(true);
    },
    [anyActiveRuns, setRouteError],
  );

  const onCloseResetModal = useCallback(() => {
    if (resetModalBusy) return;
    setResetModalOpen(false);
  }, [resetModalBusy]);

  const onResetTextChange = useCallback((value: string) => {
    setResetModalText(value);
  }, []);

  const onConfirmReset = useCallback(() => {
    if (resetModalBusy) return;
    if (anyActiveRuns) {
      const message = t("system.stop_active_runs_before_reset");
      setError(message);
      setRouteError?.(message);
      return;
    }
    if (
      resetModalMode !== "onboarding" &&
      !matchesResetConfirmation(resetModalText)
    ) {
      return;
    }

    setResetModalBusy(true);
    setError(null);
    setStatus(t("settings.resetting"));
    setRouteError?.(null);

    void (async () => {
      try {
        let quitAfterReset = false;
        if (isDesktopRuntime()) {
          const result = await resetOnMyAgentState(resetModalMode);
          quitAfterReset = result?.quit === true;
        }
        // Onboarding: rewrite prefs then soft-reload into #/welcome.
        // Full wipe: main process exits after scheduling a deferred cleaner
        // (do not app.relaunch here — that races the live userData delete).
        clearLocalStorageForOnMyAgentReset(resetModalMode);
        if (resetModalMode === "onboarding") {
          softReenterWelcomeGuide();
        } else if (quitAfterReset) {
          return;
        } else if (isDesktopRuntime()) {
          await relaunchDesktopApp();
        } else {
          window.location.reload();
        }
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : safeStringify(caught);
        const withHint = addOpencodeCacheHint(message);
        setError(withHint);
        setRouteError?.(withHint);
        setStatus(null);
        setResetModalBusy(false);
      }
    })();
  }, [
    anyActiveRuns,
    resetModalBusy,
    resetModalMode,
    resetModalText,
    setRouteError,
  ]);

  return useMemo<RecoveryViewProps>(
    () => ({
      busy: false,
      anyActiveRuns,
      resetModalOpen,
      resetModalMode,
      resetModalText,
      resetModalBusy,
      canReset,
      status,
      error,
      onOpenResetModal,
      onCloseResetModal,
      onResetTextChange,
      onConfirmReset,
    }),
    [
      anyActiveRuns,
      canReset,
      error,
      onCloseResetModal,
      onConfirmReset,
      onOpenResetModal,
      onResetTextChange,
      resetModalBusy,
      resetModalMode,
      resetModalOpen,
      resetModalText,
      status,
    ],
  );
}
