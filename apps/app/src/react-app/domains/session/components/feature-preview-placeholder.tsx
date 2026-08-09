/** @jsxImportSource react */
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import {
  DEVICES_EMPTY_STATE_ASSET,
  SCHEDULED_TASKS_PREVIEW_ASSET,
} from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";

type FeaturePreviewPlaceholderProps = {
  kind: "scheduledTasks" | "devices";
};

function ScheduledTasksIllustration() {
  return (
    <div className="relative flex h-48 w-full max-w-[360px] items-center justify-center overflow-hidden rounded-xl bg-transparent">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,var(--dls-hover)_0%,transparent_65%)]" />
      <EmptyStateIllustration
        src={SCHEDULED_TASKS_PREVIEW_ASSET}
        className="relative mb-0"
      />
    </div>
  );
}

/** Vendored Koboyo desktop illustration — theme-aware mask paint. */
function DevicesIllustration() {
  return (
    <div className="relative flex h-48 w-full max-w-[360px] items-center justify-center overflow-hidden rounded-xl bg-transparent">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,var(--dls-hover)_0%,transparent_65%)]" />
      <EmptyStateIllustration
        src={DEVICES_EMPTY_STATE_ASSET}
        className="relative mb-0"
      />
    </div>
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
