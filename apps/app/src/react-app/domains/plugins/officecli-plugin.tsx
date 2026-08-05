/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import type {
  OfficeCliProgress,
  OfficeCliStatus,
} from "@onmyagent/types/officecli";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
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
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

const OFFICECLI_ICON_SRC = "/connector-icons/officecli.png";

import {
  connectorTileClassName,
  connectorTileDescClassName,
  connectorTileFooterClassName,
  connectorTileHeaderClassName,
} from "./connector-tile";
import {
  canUninstallOfficeCli,
  getOfficeCliPrimaryAction,
  getOfficeCliStatusTone,
  isOfficeCliBusy,
  type OfficeCliPrimaryAction,
} from "./officecli-plugin-state";

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

type OfficeCliStatusKey =
  | "plugins.officecli_status_checking"
  | "plugins.officecli_status_error"
  | "plugins.officecli_status_installing"
  | "plugins.officecli_status_installed"
  | "plugins.officecli_status_not_installed"
  | "plugins.officecli_status_uninstalling"
  | "plugins.officecli_status_unsupported"
  | "plugins.officecli_status_update_available"
  | "plugins.officecli_status_updating";

type OfficeCliProgressKey =
  | "plugins.officecli_progress_checking"
  | "plugins.officecli_progress_downloading_binary"
  | "plugins.officecli_progress_downloading_manifest"
  | "plugins.officecli_progress_downloading_skill"
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

function statusLabelKey(status: OfficeCliStatus): OfficeCliStatusKey {
  switch (status.state) {
    case "checking":
      return "plugins.officecli_status_checking";
    case "installing":
      return "plugins.officecli_status_installing";
    case "updating":
      return "plugins.officecli_status_updating";
    case "uninstalling":
      return "plugins.officecli_status_uninstalling";
    case "installed":
      return "plugins.officecli_status_installed";
    case "update_available":
      return "plugins.officecli_status_update_available";
    case "unsupported":
      return "plugins.officecli_status_unsupported";
    case "error":
      return "plugins.officecli_status_error";
    case "not_installed":
      return "plugins.officecli_status_not_installed";
  }
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

function primaryActionLabel(action: OfficeCliPrimaryAction): string {
  switch (action) {
    case "install":
      return t("plugins.officecli_install");
    case "update":
      return t("plugins.officecli_update");
    case "retry":
      return t("plugins.officecli_retry");
  }
}

function primaryActionIcon(action: OfficeCliPrimaryAction) {
  switch (action) {
    case "install":
      return Download;
    case "update":
      return RefreshCw;
    case "retry":
      return RotateCcw;
  }
}

function officeCliVersionSummary(status: OfficeCliStatus): string {
  if (!status.installedVersion) return t("plugins.officecli_not_installed_hint");
  if (status.state === "update_available" && status.latestVersion) {
    return t("plugins.officecli_update_hint", {
      installed: status.installedVersion,
      latest: status.latestVersion,
    });
  }
  return t("plugins.officecli_installed_hint", {
    version: status.installedVersion,
  });
}

export function OfficeCliPluginSection() {
  const [status, setStatus] = useState<OfficeCliStatus | null>(null);
  const [progress, setProgress] = useState<OfficeCliProgress | null>(null);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);

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
  const tone: StatusBadgeTone = status
    ? getOfficeCliStatusTone(status)
    : "neutral";
  const canUninstall = status ? canUninstallOfficeCli(status) : false;

  const handlePrimaryAction = async () => {
    if (!status || !primaryAction || busy) return;
    if (primaryAction === "retry") {
      await refreshStatus(true);
      return;
    }

    setProgress({
      operation: primaryAction === "update" ? "update" : "install",
      phase: "checking",
    });
    setStatus({ ...status, state: primaryAction === "update" ? "updating" : "installing" });
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
    setStatus({ ...status, state: "uninstalling" });
    setProgress({ operation: "uninstall", phase: "installing" });
    try {
      setStatus(await uninstallOfficeCli());
    } catch (error) {
      setStatus(createErrorStatus(status, error));
    } finally {
      setProgress(null);
    }
  };

  const progressLabel = progress ? progressLabelKey(progress) : null;
  const PrimaryActionIcon = primaryAction ? primaryActionIcon(primaryAction) : null;

  return (
    <section
      className="space-y-3 border-t border-dls-border/50 pt-8"
      aria-labelledby="officecli-section-heading"
    >
      <div className="space-y-1">
        <h2
          id="officecli-section-heading"
          className="mb-2 text-sm font-medium leading-5 text-dls-text"
        >
          {t("plugins.officecli_section_title")}
        </h2>
        <p className="max-w-3xl text-pretty text-xs leading-5 text-dls-secondary">
          {t("plugins.officecli_section_hint")}
        </p>
      </div>

      <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <article
          className={cn(connectorTileClassName, "cursor-default")}
          data-plugin-id="officecli"
          aria-busy={busy}
        >
          <div className={connectorTileHeaderClassName}>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-black/5 bg-dls-surface p-1.5">
              <img
                src={resolvePublicAssetUrl(OFFICECLI_ICON_SRC)}
                alt=""
                className="size-full object-contain"
                draggable={false}
              />
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-dls-text">
                {t("plugins.officecli_title")}
              </h3>
              {status ? (
                <StatusBadge tone={tone} size="tiny">
                  {t(statusLabelKey(status))}
                </StatusBadge>
              ) : (
                <LoadingSpinner size="sm" />
              )}
            </div>
          </div>

          <p
            className={connectorTileDescClassName}
            title={t("plugins.officecli_description")}
          >
            {status ? officeCliVersionSummary(status) : t("plugins.officecli_checking")}
          </p>

          <div className={connectorTileFooterClassName}>
            {!status || status.state === "checking" ? (
              <span
                className="inline-flex items-center gap-1.5 text-xs text-dls-secondary"
                aria-live="polite"
              >
                <LoadingSpinner size="sm" />
                {t("plugins.officecli_checking")}
              </span>
            ) : progressLabel ? (
              <span
                className="inline-flex items-center gap-1.5 text-xs text-dls-secondary"
                aria-live="polite"
              >
                <LoadingSpinner size="sm" />
                {t(progressLabel)}
              </span>
            ) : primaryAction && PrimaryActionIcon ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void handlePrimaryAction()}
              >
                <PrimaryActionIcon aria-hidden="true" />
                {primaryActionLabel(primaryAction)}
              </Button>
            ) : canUninstall ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => setUninstallConfirmOpen(true)}
              >
                <Trash2 aria-hidden="true" />
                {t("plugins.officecli_uninstall")}
              </Button>
            ) : (
              <span className="text-xs text-dls-secondary">
                {status?.supported
                  ? t("plugins.officecli_desktop_only")
                  : t("plugins.officecli_unsupported_hint")}
              </span>
            )}
          </div>
        </article>
      </div>

      {status?.state === "error" ? (
        <NoticeBox tone="error" role="alert" className="max-w-xl">
          {t("plugins.officecli_error_hint")}
        </NoticeBox>
      ) : null}

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
    </section>
  );
}
