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
};

/**
 * 强制刷新弹窗：新增/修改/删除自定义模型服务商后，引擎配置已变更，
 * 需要重新加载引擎（非重启 App）才能使修改生效。弹窗不可通过 ESC、
 * 点击遮罩或关闭按钮关闭，只有点击「立刻刷新」并完成重载后才会关闭。
 */
export function ProviderReloadRequiredModal(props: ProviderReloadRequiredModalProps) {
  return (
    <Dialog
      open={props.open}
      // 强制弹窗：忽略 ESC / 外部点击 / 关闭按钮，仅由 onReload 完成后受控关闭。
      onOpenChange={() => {}}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 inline-flex size-16 items-center justify-center rounded-full bg-dls-status-warning-soft text-dls-status-warning-fg sm:row-span-2 *:[svg:not([class*='size-'])]:size-8">
            <RefreshCcw className={props.busy ? "size-8 animate-spin" : "size-8"} />
          </div>
          <DialogTitle className="text-center sm:text-left">
            {t("settings.provider_reload_required_title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.provider_reload_required_desc")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="lg" onClick={props.onReload} disabled={props.busy}>
            {props.busy ? (
              <LoadingSpinner size="sm" className="mr-1.5" />
            ) : (
              <RefreshCcw className="mr-1.5 size-3.5" />
            )}
            {t("settings.provider_reload_now")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
