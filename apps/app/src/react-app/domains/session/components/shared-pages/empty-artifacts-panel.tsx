/** @jsxImportSource react */
import { FileText, PanelRight } from "lucide-react";

import { t } from "../../../../../i18n";
import { Button } from "@/components/ui/button";

export function EmptyArtifactsPanel(props: { onClose: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-surface">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-dls-border px-4 mac:titlebar-no-drag">
        <div className="flex items-center gap-2 text-sm font-medium text-dls-text">
          <FileText className="size-4 text-dls-secondary" />
          产物
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-dls-secondary hover:text-dls-text"
          onClick={props.onClose}
          aria-label={t("session.close_artifacts_panel")}
          title={t("common.close")}
        >
          <PanelRight className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <section className="flex min-h-[180px] items-center justify-center border-b border-dls-border px-6 text-center">
          <div className="space-y-3 text-dls-secondary">
            <FileText className="mx-auto size-8 opacity-45" />
            <div className="text-sm">本会话尚未生成新文件</div>
          </div>
        </section>
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-11 items-center border-b border-dls-border px-4 text-sm font-medium text-dls-text">
            文件
          </div>
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-dls-secondary">
            空目录
          </div>
        </section>
      </div>
    </div>
  );
}
