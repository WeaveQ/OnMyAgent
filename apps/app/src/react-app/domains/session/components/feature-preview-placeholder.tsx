import {
  CalendarDays,
  Check,
  Clock3,
  Play,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { t } from "@/i18n";

const DEVICES_PLACEHOLDER_ASSET = "/empty-states/devices-placeholder.png";

type FeaturePreviewPlaceholderProps = {
  kind: "scheduledTasks" | "devices";
};

function ScheduledTasksIllustration() {
  return (
    <div className="relative flex h-48 w-full max-w-[360px] items-center justify-center overflow-hidden rounded-xl border border-dls-status-warning-border bg-gradient-to-br from-dls-status-warning/10 via-dls-accent/5 to-dls-surface">
      <div className="absolute -left-8 top-5 size-28 rounded-full bg-dls-status-warning-soft blur-2xl" />
      <div className="absolute -right-4 bottom-0 size-32 rounded-full bg-dls-accent/10 blur-2xl" />
      <div className="relative flex w-[250px] items-center gap-4 rounded-xl border border-dls-surface/90 bg-dls-surface p-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-dls-status-warning-soft text-dls-status-warning-fg">
          <Clock3 className="size-7" />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="h-2.5 w-24 rounded-full bg-dls-text/80" />
            <Play className="size-4 fill-dls-status-success-fg text-dls-status-success-fg" />
          </div>
          <div className="flex items-center gap-2 text-dls-status-warning">
            <CalendarDays className="size-4" />
            <span className="h-2 w-20 rounded-full bg-dls-status-warning/25" />
          </div>
          <div className="flex items-center gap-2 text-dls-status-success-fg">
            <Check className="size-4" />
            <span className="h-2 w-28 rounded-full bg-dls-status-success-soft" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DevicesIllustration() {
  return (
    <img
      src={resolvePublicAssetUrl(DEVICES_PLACEHOLDER_ASSET)}
      alt=""
      loading="lazy"
      className="h-auto w-full max-w-[360px]"
      draggable={false}
    />
  );
}

export function FeaturePreviewPlaceholder(
  props: FeaturePreviewPlaceholderProps,
) {
  const scheduledTasks = props.kind === "scheduledTasks";

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto bg-dls-background px-6 py-12 text-center">
      <div className="flex w-full max-w-xl flex-col items-center">
        {scheduledTasks ? (
          <ScheduledTasksIllustration />
        ) : (
          <DevicesIllustration />
        )}
        <StatusBadge className="mt-7" tone="surface" size="default">
          {t("feature_preview.in_development")}
        </StatusBadge>
        <h2 className="mt-3 text-lg font-medium text-dls-text">
          {scheduledTasks
            ? t("feature_preview.scheduled_tasks_title")
            : t("feature_preview.devices_title")}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-dls-secondary">
          {scheduledTasks
            ? t("feature_preview.scheduled_tasks_body")
            : t("feature_preview.devices_body")}
        </p>
      </div>
    </div>
  );
}
