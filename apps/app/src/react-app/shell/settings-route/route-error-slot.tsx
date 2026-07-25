/** @jsxImportSource react */
import { Button } from "@/components/ui/button";

import { relaunchDesktopApp } from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import type { UserErrorActionId } from "../../kernel/user-error";

export function SettingsRouteErrorSlot(props: {
  action: UserErrorActionId | null;
  onRetry: () => void;
  onOpenAiSettings: () => void;
}) {
  if (!props.action) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {props.action === "retry" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={props.onRetry}
        >
          {t("system.error_action_retry")}
        </Button>
      ) : null}
      {props.action === "open_ai_settings" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={props.onOpenAiSettings}
        >
          {t("system.error_action_open_ai_settings")}
        </Button>
      ) : null}
      {props.action === "reload_app" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (isElectronRuntime()) {
              void relaunchDesktopApp().catch(() => {
                window.location.reload();
              });
              return;
            }
            window.location.reload();
          }}
        >
          {t("system.error_action_reload_app")}
        </Button>
      ) : null}
    </div>
  );
}
