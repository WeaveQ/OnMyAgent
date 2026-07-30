/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";
import { formatAcceleratorForDisplay } from "../keymap";

export type AppSnapshotViewProps = {
  busy?: boolean;
  appSnapshotHotkey: string;
  onAppSnapshotHotkeyChange: (hotkey: string) => void;
};

export function AppSnapshotView(props: AppSnapshotViewProps) {
  const desktop = isDesktopRuntime();
  const [platform, setPlatform] = useState<"macos" | "windows" | "linux" | "unknown">(
    "unknown",
  );
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void (async () => {
      try {
        const result = (await desktopBridge.checkSystemPermissions()) as {
          platform?: "macos" | "windows" | "linux" | "unknown";
        };
        if (result?.platform) setPlatform(result.platform);
      } catch {
        // ignore
      }
    })();
  }, [desktop]);

  // Windows: prefer double-control token display; mac keeps double-command.
  const displayHotkey =
    props.appSnapshotHotkey ||
    (platform === "windows" ? "double-control" : "double-command");

  const openAccessibility = useCallback(async () => {
    if (!desktop) return;
    try {
      await desktopBridge.openSystemPermissionSettings("accessibility");
    } catch {
      // ignore
    }
  }, [desktop]);

  const captureNow = useCallback(async () => {
    if (!desktop) return;
    setCapturing(true);
    setStatus(null);
    try {
      await desktopBridge.captureComputerUseAppshot();
      setStatus("ok");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCapturing(false);
    }
  }, [desktop]);

  return (
    <LayoutStack>
      <SettingsPageSection
        title={t("settings.app_snapshot_title")}
        description={t("settings.app_snapshot_desc")}
      >
        {!desktop ? (
          <p className="mb-3 text-sm text-dls-secondary">
            {t("settings.desktop_only_hint")}
          </p>
        ) : null}

        {platform === "macos" ? (
          <div className="mb-4 overflow-hidden rounded-2xl border border-dls-border bg-gradient-to-br from-sky-100/80 to-emerald-50/80 px-6 py-8 text-center dark:from-sky-950/40 dark:to-emerald-950/30">
            <p className="font-mono text-3xl tracking-widest text-dls-text">
              ⌘&nbsp;&nbsp;⌘
            </p>
            <p className="mt-2 text-xs text-dls-secondary">
              {formatAcceleratorForDisplay(displayHotkey, platform)}
            </p>
          </div>
        ) : null}

        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.app_snapshot_hotkey_label")}
            description={t("settings.app_snapshot_hotkey_desc")}
            actions={
              <span className="rounded-md border border-dls-border bg-dls-surface px-2 py-1 font-mono text-xs text-dls-text">
                {formatAcceleratorForDisplay(displayHotkey, platform)}
              </span>
            }
          />
        </SettingsBlock>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          <span className="min-w-0 flex-1">
            {t("settings.app_snapshot_hotkey_saved")}
          </span>
          {platform === "macos" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!desktop || props.busy}
              onClick={() => void openAccessibility()}
            >
              <ExternalLink className="size-3.5" />
              {t("settings.app_snapshot_open_accessibility")}
            </Button>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!desktop || props.busy || capturing}
            onClick={() => void captureNow()}
          >
            {t("settings.app_snapshot_capture_now")}
          </Button>
          {status && status !== "ok" ? (
            <span className="text-sm text-dls-danger">{status}</span>
          ) : null}
        </div>
      </SettingsPageSection>
    </LayoutStack>
  );
}
