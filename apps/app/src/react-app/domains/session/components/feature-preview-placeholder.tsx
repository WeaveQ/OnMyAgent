/** @jsxImportSource react */
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { t } from "@/i18n";
import {
  DEVICES_EMPTY_STATE_ASSET,
  SCHEDULED_TASKS_PREVIEW_ASSET,
} from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";

type FeaturePreviewKind = "scheduledTasks" | "devices";

type FeaturePreviewPlaceholderProps = {
  kind: FeaturePreviewKind;
};

const FEATURE_PREVIEW_COPY: Record<
  FeaturePreviewKind,
  { asset: string; title: Parameters<typeof t>[0]; body: Parameters<typeof t>[0] }
> = {
  scheduledTasks: {
    asset: SCHEDULED_TASKS_PREVIEW_ASSET,
    title: "feature_preview.scheduled_tasks_title",
    body: "feature_preview.scheduled_tasks_body",
  },
  devices: {
    asset: DEVICES_EMPTY_STATE_ASSET,
    title: "feature_preview.devices_title",
    body: "feature_preview.devices_body",
  },
};

export function FeaturePreviewPlaceholder(
  props: FeaturePreviewPlaceholderProps,
) {
  const copy = FEATURE_PREVIEW_COPY[props.kind];

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto bg-dls-background px-6 py-12">
      <Empty variant="ghost" className="max-w-xl flex-none">
        <EmptyHeader>
          <EmptyMedia>
            <EmptyStateIllustration src={copy.asset} className="mb-0 max-h-60 rounded-lg" />
          </EmptyMedia>
          <StatusBadge tone="surface" size="default">
            {t("feature_preview.in_development")}
          </StatusBadge>
          <EmptyTitle className="text-lg text-dls-text">
            {t(copy.title)}
          </EmptyTitle>
          <EmptyDescription className="max-w-md text-dls-secondary">
            {t(copy.body)}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
