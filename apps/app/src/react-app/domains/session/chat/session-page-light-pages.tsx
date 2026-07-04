/** @jsxImportSource react */
import { FileText, PanelRight } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";

const lightPagesTextClass = {
  panelTitle: "text-base font-medium text-dls-text",
};

export function ProjectsComingSoonPage() {
  return (
    <div className="flex h-full items-center justify-center bg-dls-background px-6 text-center">
      <div className="space-y-2">
        <div className={lightPagesTextClass.panelTitle}>
          {t("common.in_development")}
        </div>
        <div className="text-sm text-dls-secondary">
          {t("common.coming_soon_short")}
        </div>
      </div>
    </div>
  );
}

export function EmptyArtifactsPanel(props: { onClose: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4 mac:titlebar-no-drag">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="size-4 text-muted-foreground" />
          产物
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={props.onClose}
          aria-label={t("session.close_artifacts_panel")}
          title={t("common.close")}
        >
          <PanelRight className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <section className="flex min-h-[180px] items-center justify-center border-b border-border px-6 text-center">
          <div className="space-y-3 text-muted-foreground">
            <FileText className="mx-auto size-8 opacity-45" />
            <div className="text-sm">本会话尚未生成新文件</div>
          </div>
        </section>
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-11 items-center border-b border-border px-4 text-sm font-medium text-foreground">
            文件
          </div>
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            空目录
          </div>
        </section>
      </div>
    </div>
  );
}
