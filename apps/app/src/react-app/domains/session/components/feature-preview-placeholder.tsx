import {
  CalendarDays,
  Check,
  Clock3,
  Play,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";

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

/** Laptop + phone + link badge — monochrome line/fill, no color gradients. */
function DevicesIllustration() {
  return (
    <div className="relative flex h-48 w-full max-w-[360px] items-center justify-center overflow-hidden rounded-xl bg-transparent">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,var(--dls-hover)_0%,transparent_65%)]" />
      <svg
        viewBox="0 0 160 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="relative h-[112px] w-[180px] text-dls-secondary"
      >
        {/* Laptop body */}
        <rect
          x="18"
          y="28"
          width="78"
          height="48"
          rx="4"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect
          x="24"
          y="34"
          width="66"
          height="32"
          rx="2"
          fill="currentColor"
          fillOpacity="0.08"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M12 80h90c2 0 3.5 1.2 3.5 2.5S104 85 102 85H12c-2 0-3.5-1.2-3.5-2.5S10 80 12 80Z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Phone */}
        <rect
          x="98"
          y="22"
          width="34"
          height="56"
          rx="5"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect
          x="103"
          y="30"
          width="24"
          height="36"
          rx="2"
          fill="currentColor"
          fillOpacity="0.08"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="115" cy="72" r="2" fill="currentColor" fillOpacity="0.55" />
        {/* Connection badge */}
        <circle
          cx="88"
          cy="68"
          r="14"
          fill="var(--dls-surface)"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Wi-Fi arcs */}
        <path
          d="M80.5 66.5c2-2.2 4.6-3.4 7.5-3.4s5.5 1.2 7.5 3.4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path
          d="M83.2 69.2c1.2-1.3 2.9-2 4.8-2s3.6.7 4.8 2"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <circle cx="88" cy="72.5" r="1.6" fill="currentColor" />
      </svg>
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
