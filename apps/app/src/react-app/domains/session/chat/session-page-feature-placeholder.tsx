/** @jsxImportSource react */

import { IconTile } from "@/components/ui/action-row";
import { FeaturePreviewPlaceholder } from "../components/feature-preview-placeholder";

import {
  SIDEBAR_VIEW_ICONS,
  SIDEBAR_VIEW_LABELS,
  type SidebarFeatureView,
} from "./session-page-sidebar-view-model";

const featurePlaceholderTextClass = {
  emptyTitle: "mt-5 text-base font-medium text-dls-text",
};

export function SidebarFeaturePlaceholder(props: {
  view: SidebarFeatureView;
}) {
  if (props.view === "scheduledTasks") {
    return <FeaturePreviewPlaceholder kind="scheduledTasks" />;
  }

  const Icon = SIDEBAR_VIEW_ICONS[props.view];
  const label = SIDEBAR_VIEW_LABELS[props.view];

  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6 py-16">
      <div className="flex max-w-sm flex-col items-center text-center">
        <IconTile size="lg" shape="xl" border>
          <Icon className="size-6" />
        </IconTile>
        <h2 className={featurePlaceholderTextClass.emptyTitle}>{label}</h2>
        <p className="mt-2 text-sm text-dls-secondary">开发中，敬请期待</p>
      </div>
    </div>
  );
}
