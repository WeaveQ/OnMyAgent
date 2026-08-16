/** @jsxImportSource react */
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import {
  DEVICES_EMPTY_STATE_ASSET,
  KNOWLEDGE_BASE_PLACEHOLDER_ASSET,
  SCHEDULED_TASKS_PREVIEW_ASSET,
} from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";

type FeaturePreviewKind = "scheduledTasks" | "devices" | "knowledgeBase";

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
  knowledgeBase: {
    asset: KNOWLEDGE_BASE_PLACEHOLDER_ASSET,
    title: "feature_preview.knowledge_base_title",
    body: "feature_preview.knowledge_base_body",
  },
};

function FeaturePreviewIllustration(props: { src: string }) {
  return (
    <div className="relative flex h-48 w-full max-w-[360px] items-center justify-center overflow-hidden rounded-xl bg-transparent">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,var(--dls-hover)_0%,transparent_65%)]" />
      <EmptyStateIllustration
        src={props.src}
        className="relative mb-0"
      />
    </div>
  );
}

export function FeaturePreviewPlaceholder(
  props: FeaturePreviewPlaceholderProps,
) {
  const copy = FEATURE_PREVIEW_COPY[props.kind];

  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto bg-dls-background px-6 py-12 text-center">
      <div className="flex w-full max-w-xl flex-col items-center">
        <FeaturePreviewIllustration src={copy.asset} />
        <StatusBadge className="mt-7" tone="surface" size="default">
          {t("feature_preview.in_development")}
        </StatusBadge>
        <h2 className="mt-3 text-lg font-medium text-dls-text">
          {t(copy.title)}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-dls-secondary">
          {t(copy.body)}
        </p>
      </div>
    </div>
  );
}
