/** @jsxImportSource react */
import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatRelativeTime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import type { ReleaseChannel } from "../../../../app/types";
import type { SettingsUpdateStatus } from "../state/electron-updater-state";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutStack,
} from "../settings-layout";
import { Separator } from "@/components/ui/separator";

export type UpdatesViewProps = {
  busy: boolean;
  webDeployment: boolean;
  appVersion: string | null;
  updateEnv: { supported?: boolean; reason?: string | null } | null;
  updateAutoCheck: boolean;
  toggleUpdateAutoCheck: () => void;
  /** @deprecated No in-app download; ignored by the lightweight updater. */
  updateAutoDownload?: boolean;
  /** @deprecated No in-app download; ignored by the lightweight updater. */
  toggleUpdateAutoDownload?: () => void;
  updateStatus: SettingsUpdateStatus;
  anyActiveRuns: boolean;
  checkForUpdates: () => void | Promise<void>;
  downloadUpdate: () => void | Promise<void>;
  installUpdateAndRestart: () => void | Promise<void>;
  /** Currently selected release channel. Optional; callers may omit. */
  releaseChannel?: ReleaseChannel;
  /**
   * Change the release channel. When not provided, the channel row is
   * rendered read-only — useful for contexts where the pref can't be
   * mutated (e.g. web preview).
   */
  onReleaseChannelChange?: (next: ReleaseChannel) => void;
  /**
   * Whether the alpha channel is available. Lightweight updater reports
   * false; when false the channel selector is hidden.
   */
  alphaChannelSupported?: boolean;
};

export function UpdatesView(props: UpdatesViewProps) {
  const updateState = props.updateStatus?.state ?? "idle";
  const updateVersion = props.updateStatus?.version ?? null;
  const updateDate = props.updateStatus?.date ?? null;
  const updateLastCheckedAt = props.updateStatus?.lastCheckedAt ?? null;
  const updateErrorMessage = props.updateStatus?.message ?? null;
  const updateNotes = props.updateStatus?.notes ?? null;
  const softNotice =
    (updateState === "idle" || updateState === "error") &&
    updateErrorMessage &&
    (props.updateStatus?.soft || updateState === "idle")
      ? updateErrorMessage
      : null;
  const hardError =
    updateState === "error" && updateErrorMessage && !props.updateStatus?.soft
      ? updateErrorMessage
      : null;
  const showOpenReleaseWithSoft =
    Boolean(softNotice) && props.updateStatus?.showOpenReleasePage !== false;

  return (
    <LayoutStack>
      {props.appVersion ? (
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>
              {t("settings.shell_view_current_version_description")}
            </LayoutSectionItemTitle>
            <LayoutSectionItemDescription className="font-mono">
              v{props.appVersion}
              {updateLastCheckedAt ? (
                <span className="ml-2 font-sans text-xs text-dls-secondary">
                  {t("settings.update_last_checked", undefined, {
                    time: formatRelativeTime(updateLastCheckedAt),
                  })}
                </span>
              ) : null}
            </LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void props.checkForUpdates()}
                disabled={props.busy || updateState === "checking"}
              >
                {updateState === "checking"
                  ? t("settings.checking_for_updates")
                  : t("settings.check_for_updates")}
              </Button>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      ) : null}

      {updateState === "available" && updateVersion ? (
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>
              {t("settings.update_available_version", undefined, {
                version: updateVersion,
              })}
            </LayoutSectionItemTitle>
            {updateDate ? (
              <LayoutSectionItemDescription>
                {t("settings.update_published", undefined, { date: updateDate })}
              </LayoutSectionItemDescription>
            ) : null}
            <LayoutSectionItemHeaderActions>
              <Button
                variant="default"
                size="sm"
                onClick={() => void props.downloadUpdate()}
              >
                {t("settings.open_release_page")}
              </Button>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      ) : null}

      {hardError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{hardError}</AlertDescription>
        </Alert>
      ) : null}

      {softNotice ? (
        <Alert>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{softNotice}</span>
            {showOpenReleaseWithSoft ? (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                onClick={() => void props.downloadUpdate()}
              >
                {t("settings.open_release_page")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {updateState === "available" && updateNotes ? (
        <LayoutSectionItem className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-dls-secondary">
          {updateNotes}
        </LayoutSectionItem>
      ) : null}

      {props.webDeployment ? (
        <Alert>
          <AlertDescription>
            {t("settings.updates_desktop_only")}
          </AlertDescription>
        </Alert>
      ) : props.updateEnv && props.updateEnv.supported === false ? (
        <Alert>
          <AlertDescription>
            {props.updateEnv.reason ?? t("settings.updates_not_supported")}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Separator />
          <LayoutSectionItem>
            <LayoutSectionItemHeader>
              <LayoutSectionItemTitle>
                {t("settings.background_checks_title")}
              </LayoutSectionItemTitle>
              <LayoutSectionItemDescription>
                {t("settings.background_checks_desc_notify")}
              </LayoutSectionItemDescription>
              <LayoutSectionItemHeaderActions>
                <Switch
                  aria-label={t("settings.background_checks_title")}
                  checked={props.updateAutoCheck}
                  onCheckedChange={props.toggleUpdateAutoCheck}
                />
              </LayoutSectionItemHeaderActions>
            </LayoutSectionItemHeader>
          </LayoutSectionItem>

          <LayoutSectionItem>
            <LayoutSectionItemHeader>
              <LayoutSectionItemTitle>
                {t("settings.update_install_title")}
              </LayoutSectionItemTitle>
              <LayoutSectionItemDescription>
                {t("settings.update_install_desc")}
              </LayoutSectionItemDescription>
            </LayoutSectionItemHeader>
          </LayoutSectionItem>
        </>
      )}
    </LayoutStack>
  );
}
