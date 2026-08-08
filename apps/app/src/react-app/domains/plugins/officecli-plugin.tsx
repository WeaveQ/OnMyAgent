/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  OfficeCliProgress,
  OfficeCliStatus,
} from "@onmyagent/types/officecli";

import { NoticeBox } from "@/components/ui/notice-box";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  getOfficeCliStatus,
  installOfficeCli,
  subscribeOfficeCliProgress,
  subscribeOfficeCliStatus,
  uninstallOfficeCli,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";

import { ConnectorConnectDialog } from "./connector-connect-dialog";
import {
  ConnectorStatusCard,
  type ConnectorCardStatus,
} from "./connector-status-card";
import {
  canUninstallOfficeCli,
  getOfficeCliPrimaryAction,
  isOfficeCliBusy,
} from "./officecli-plugin-state";

const OFFICECLI_ICON_SRC = "/connector-icons/officecli.png";

const OFFICECLI_UNSUPPORTED_STATUS = {
  pluginId: "officecli",
  state: "unsupported",
  supported: false,
  platform: "web",
  installedVersion: null,
  latestVersion: null,
  previousVersion: null,
  usable: false,
  lastCheckedAt: null,
} satisfies OfficeCliStatus;

type OfficeCliProgressKey =
  | "plugins.officecli_progress_checking"
  | "plugins.officecli_progress_downloading_binary"
  | "plugins.officecli_progress_downloading_manifest"
  | "plugins.officecli_progress_downloading_skill"
  | "plugins.officecli_progress_downloading_skills_pack"
  | "plugins.officecli_progress_installing"
  | "plugins.officecli_progress_refreshing_skills"
  | "plugins.officecli_progress_uninstalling"
  | "plugins.officecli_progress_verifying";

function createErrorStatus(
  current: OfficeCliStatus | null,
  error: unknown,
): OfficeCliStatus {
  const errorCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : error &&
          typeof error === "object" &&
          "errorCode" in error &&
          typeof error.errorCode === "string"
        ? error.errorCode
        : "officecli_error";
  return {
    ...(current ?? {
      ...OFFICECLI_UNSUPPORTED_STATUS,
      supported: true,
      platform: "unknown",
    }),
    state: "error",
    errorCode,
    errorMessage: undefined,
  };
}

function progressLabelKey(progress: OfficeCliProgress): OfficeCliProgressKey | null {
  if (progress.operation === "uninstall" && progress.phase === "installing") {
    return "plugins.officecli_progress_uninstalling";
  }
  switch (progress.phase) {
    case "checking":
      return "plugins.officecli_progress_checking";
    case "downloading_manifest":
      return "plugins.officecli_progress_downloading_manifest";
    case "downloading_binary":
      return "plugins.officecli_progress_downloading_binary";
    case "downloading_skill":
      return "plugins.officecli_progress_downloading_skill";
    case "downloading_skills_pack":
      return "plugins.officecli_progress_downloading_skills_pack";
    case "verifying":
      return "plugins.officecli_progress_verifying";
    case "installing":
      return "plugins.officecli_progress_installing";
    case "refreshing_skills":
      return "plugins.officecli_progress_refreshing_skills";
    case "complete":
      return null;
  }
}

function officecliTryPrompts(): string[] {
  return [
    t("plugins.officecli_prompt_1"),
    t("plugins.officecli_prompt_2"),
    t("plugins.officecli_prompt_3"),
  ];
}

/**
 * OfficeCLI card — P1 status card + P0 connect dialog (clickable when installed).
 */
export function OfficeCliPluginCard(props: {
  onTryPrompt?: (prompt: string) => void;
}) {
  const [status, setStatus] = useState<OfficeCliStatus | null>(null);
  const [progress, setProgress] = useState<OfficeCliProgress | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const refreshStatus = useCallback(async (forceRefresh: boolean) => {
    if (!isDesktopRuntime()) {
      setStatus(OFFICECLI_UNSUPPORTED_STATUS);
      return;
    }

    setStatus((current) =>
      current ? { ...current, state: "checking", errorCode: undefined } : current,
    );
    try {
      setStatus(await getOfficeCliStatus({ forceRefresh }));
    } catch (error) {
      setStatus((current) => createErrorStatus(current, error));
    }
  }, []);

  useEffect(() => {
    void refreshStatus(true);
    if (!isDesktopRuntime()) return undefined;
    const unsubscribeProgress = subscribeOfficeCliProgress((nextProgress) => {
      setProgress(nextProgress.phase === "complete" ? null : nextProgress);
    });
    const unsubscribeStatus = subscribeOfficeCliStatus((nextStatus) => {
      setStatus(nextStatus);
    });
    return () => {
      unsubscribeProgress();
      unsubscribeStatus();
    };
  }, [refreshStatus]);

  const primaryAction = useMemo(
    () => (status ? getOfficeCliPrimaryAction(status) : null),
    [status],
  );
  const busy = status ? isOfficeCliBusy(status) : true;
  const canUninstall = status ? canUninstallOfficeCli(status) : false;
  const installed =
    Boolean(status?.installedVersion) &&
    (status?.state === "installed" ||
      status?.state === "update_available" ||
      status?.usable === true);

  const cardStatus: ConnectorCardStatus = useMemo(() => {
    if (!status || busy || progress) return "pending";
    if (status.state === "error") return "error";
    if (status.state === "unsupported") return "error";
    if (installed) return "connected";
    return "idle";
  }, [busy, installed, progress, status]);

  const handleInstallOrUpdate = async () => {
    if (!status || !primaryAction || busy) return;
    if (primaryAction === "retry") {
      await refreshStatus(true);
      return;
    }
    setProgress({
      operation: primaryAction === "update" ? "update" : "install",
      phase: "checking",
    });
    setStatus({
      ...status,
      state: primaryAction === "update" ? "updating" : "installing",
    });
    try {
      setStatus(await installOfficeCli());
    } catch (error) {
      setStatus(createErrorStatus(status, error));
    } finally {
      setProgress(null);
    }
  };

  const handleUninstall = async () => {
    if (!status || busy || !status.installedVersion) return;
    setUninstallConfirmOpen(false);
    setUnbinding(true);
    setStatus({ ...status, state: "uninstalling" });
    setProgress({ operation: "uninstall", phase: "installing" });
    try {
      setStatus(await uninstallOfficeCli());
      setDetailOpen(false);
    } catch (error) {
      setStatus(createErrorStatus(status, error));
    } finally {
      setProgress(null);
      setUnbinding(false);
    }
  };

  const tryPrompts = useMemo(() => officecliTryPrompts(), []);
  const handleTryIt = () => {
    const prompt = tryPrompts[0];
    if (!prompt) return;
    props.onTryPrompt?.(prompt);
    setDetailOpen(false);
  };

  const progressLabel = progress ? progressLabelKey(progress) : null;
  const footerNote = !isDesktopRuntime()
    ? t("plugins.officecli_desktop_only")
    : status?.state === "error"
      ? t("plugins.officecli_error_hint")
      : progressLabel
        ? t(progressLabel)
        : status && !status.supported
          ? t("plugins.officecli_unsupported_hint")
          : installed && status?.installedVersion
            ? t("plugins.officecli_installed_hint", {
                version: status.installedVersion,
              })
            : null;

  return (
    <div className="min-w-0">
      <ConnectorStatusCard
        data-plugin-id="officecli"
        name={t("plugins.officecli_title")}
        description={t("plugins.officecli_description")}
        iconSrc={OFFICECLI_ICON_SRC}
        status={cardStatus}
        busy={busy && cardStatus === "pending"}
        onOpen={() => setDetailOpen(true)}
        onAction={() => {
          if (installed) {
            handleTryIt();
            return;
          }
          setDetailOpen(true);
        }}
        footer={
          status?.state === "error" ? (
            <NoticeBox tone="error" role="alert" className="mt-1 py-1.5 text-xs">
              {t("plugins.officecli_error_hint")}
            </NoticeBox>
          ) : null
        }
      />

      <ConnectorConnectDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={t("plugins.officecli_title")}
        description={t("plugins.officecli_description")}
        iconSrc={OFFICECLI_ICON_SRC}
        connected={installed}
        connecting={busy}
        connectLabel={
          primaryAction === "update"
            ? t("plugins.officecli_update")
            : primaryAction === "retry"
              ? t("plugins.officecli_retry")
              : t("plugins.officecli_install")
        }
        onConnect={
          !isDesktopRuntime() || (!primaryAction && installed)
            ? undefined
            : () => void handleInstallOrUpdate()
        }
        onTryIt={installed ? handleTryIt : undefined}
        onUnbind={
          canUninstall ? () => setUninstallConfirmOpen(true) : undefined
        }
        unbindLabel={t("plugins.officecli_uninstall")}
        unbinding={unbinding}
        tryThisPrompts={tryPrompts}
        promptsDisabled={!props.onTryPrompt || !installed}
        onSelectPrompt={
          installed && props.onTryPrompt
            ? (prompt) => {
                props.onTryPrompt?.(prompt);
                setDetailOpen(false);
              }
            : undefined
        }
        footerNote={footerNote}
      />

      <ConfirmModal
        open={uninstallConfirmOpen}
        title={t("plugins.officecli_uninstall_title")}
        message={t("plugins.officecli_uninstall_message")}
        confirmLabel={t("plugins.officecli_uninstall")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleUninstall()}
        onCancel={() => setUninstallConfirmOpen(false)}
      />
    </div>
  );
}

/** @deprecated Use OfficeCliPluginCard inside the recommended-install grid. */
export function OfficeCliPluginSection() {
  return <OfficeCliPluginCard />;
}
