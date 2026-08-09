/** @jsxImportSource react */
/**
 * Primary app-rail icons — Lucide outline language for most destinations;
 * Experts uses a vendored Koboyo consultant-badge (hand-drawn specialist mark).
 */
import {
  Briefcase,
  Building2,
  CalendarClock,
  Folder,
  HardDrive,
  House,
  MessagesSquare,
  MonitorSmartphone,
  Settings2,
  ShoppingBag,
} from "lucide-react";

import { ConsultantBadgeIcon } from "@/react-app/design-system/consultant-badge-icon";
import { cn } from "@/lib/utils";

type PrimaryRailIconProps = {
  className?: string;
  active?: boolean;
};

/** Shared stroke weight — thin line icons read like the reference rail. */
const RAIL_ICON_STROKE = 1.5;

/**
 * consultant-badge is tall (~159×229). Inline SVG at 28px height (not a
 * 22² square mask) keeps the silhouette readable on the primary rail.
 */
const RAIL_EXPERT_ICON_H = 28;

function railIconProps(className?: string) {
  return {
    className,
    strokeWidth: RAIL_ICON_STROKE,
    absoluteStrokeWidth: true as const,
    "aria-hidden": true as const,
  };
}

/** Assistant home — house outline (home entry). */
export function AssistantRailIcon(props: PrimaryRailIconProps) {
  return <House {...railIconProps(props.className)} />;
}

/**
 * Experts — Koboyo consultant-badge (person + credential).
 * Inline SVG (not CSS mask) for sharper edges at rail size; overrides
 * TopRailButton `size-5.5` so the tall glyph is not squashed.
 */
export function ExpertRailIcon(props: PrimaryRailIconProps) {
  return (
    <ConsultantBadgeIcon
      height={RAIL_EXPERT_ICON_H}
      className={cn(
        props.className,
        // After parent size-5.5 so tall glyph is not forced into a 22² square.
        "!size-auto !h-7 !w-auto max-w-none",
      )}
    />
  );
}

/** Local agent — device / monitor outline (distinct from Expert Koboyo mark). */
export function LocalAgentRailIcon(props: PrimaryRailIconProps) {
  return <MonitorSmartphone {...railIconProps(props.className)} />;
}

/** Files / workspace — folder outline. */
export function FilesRailIcon(props: PrimaryRailIconProps) {
  return <Folder {...railIconProps(props.className)} />;
}

/** Projects — briefcase outline (solid stroke, not dashed placeholder). */
export function ProjectsRailIcon(props: PrimaryRailIconProps) {
  return <Briefcase {...railIconProps(props.className)} />;
}

/** Marketplace / store — shopping bag outline. */
export function StoreRailIcon(props: PrimaryRailIconProps) {
  return <ShoppingBag {...railIconProps(props.className)} />;
}

/** Company / OnMyCompany — building outline (enterprise control plane). */
export function CompanyRailIcon(props: PrimaryRailIconProps) {
  return <Building2 {...railIconProps(props.className)} />;
}

/** Management — settings/sliders outline. */
export function ManageRailIcon(props: PrimaryRailIconProps) {
  return <Settings2 {...railIconProps(props.className)} />;
}

/** Message channels / IM — chat bubbles outline. */
export function ChannelsRailIcon(props: PrimaryRailIconProps) {
  return <MessagesSquare {...railIconProps(props.className)} />;
}

/** Automation / scheduled work — calendar + clock outline. */
export function AutomationRailIcon(props: PrimaryRailIconProps) {
  return <CalendarClock {...railIconProps(props.className)} />;
}

/** Devices — storage/device rack outline (distinct from LocalAgent monitor). */
export function DevicesRailIcon(props: PrimaryRailIconProps) {
  return <HardDrive {...railIconProps(props.className)} />;
}
