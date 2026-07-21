/** @jsxImportSource react */
import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { t } from "@/i18n";

export type ProviderReloadRequiredModalProps = {
  open: boolean;
  busy?: boolean;
  onReload: () => void;
  /** Optional copy overrides (e.g. MCP / custom connector save). */
  title?: string;
  description?: string;
  reloadLabel?: string;
  /** When set, show a secondary dismiss action (non-forced flow). */
  onDismiss?: () => void;
  dismissLabel?: string;
};

/**
 * 刷新引擎弹窗：配置变更后需重载本地引擎（非重启 App）。
 * 默认强制：忽略 ESC / 遮罩 / 关闭钮；传入 onDismiss 时可稍后处理。
 */
export function ProviderReloadRequiredModal(props: ProviderReloadRequiredModalProps) {
  const allowDismiss = Boolean(props.onDismiss);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next && allowDismiss) props.onDismiss?.();
      }}
      disablePointerDismissal={!allowDismiss}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 inline-flex size-16 items-center justify-center rounded-full bg-dls-status-warning-soft text-dls-status-warning-fg sm:row-span-2 *:[svg:not([class*='size-'])]:size-8">
            <RefreshCcw className={props.busy ? "size-8 animate-spin" : "size-8"} />
          </div>
          <DialogTitle className="text-center sm:text-left">
            {props.title ?? t("settings.provider_reload_required_title")}
          </DialogTitle>
          <DialogDescription>
            {props.description ?? t("settings.provider_reload_required_desc")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className={allowDismiss ? "gap-2 sm:justify-end" : undefined}>
          {allowDismiss ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={props.onDismiss}
              disabled={props.busy}
            >
              {props.dismissLabel ?? t("app.reload_later")}
            </Button>
          ) : null}
          <Button size="lg" onClick={props.onReload} disabled={props.busy}>
            {props.busy ? (
              <LoadingSpinner size="sm" className="mr-1.5" />
            ) : (
              <RefreshCcw className="mr-1.5 size-3.5" />
            )}
            {props.reloadLabel ?? t("settings.provider_reload_now")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
