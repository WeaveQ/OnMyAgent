/** @jsxImportSource react */
/**
 * Primary app-rail icons — unified Lucide outline language (stroke, not solid fill)
 * to match denser product rails (icon-above-label + free-float selected pill).
 */
import {
  Bot,
  CalendarClock,
  Folder,
  House,
  MessagesSquare,
  MonitorSmartphone,
  Settings2,
  ShoppingBag,
} from "lucide-react";

type PrimaryRailIconProps = {
  className?: string;
  active?: boolean;
};

/** Shared stroke weight — thin line icons read like the reference rail. */
const RAIL_ICON_STROKE = 1.5;

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

/** Experts — robot head outline. */
export function ExpertRailIcon(props: PrimaryRailIconProps) {
  return <Bot {...railIconProps(props.className)} />;
}

/** Local agent — device / monitor outline (distinct from Expert Bot). */
export function LocalAgentRailIcon(props: PrimaryRailIconProps) {
  return <MonitorSmartphone {...railIconProps(props.className)} />;
}

/** Files / workspace — folder outline. */
export function FilesRailIcon(props: PrimaryRailIconProps) {
  return <Folder {...railIconProps(props.className)} />;
}

/** Marketplace / store — shopping bag outline. */
export function StoreRailIcon(props: PrimaryRailIconProps) {
  return <ShoppingBag {...railIconProps(props.className)} />;
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

/** Devices — same monitor glyph as local agent family. */
export function DevicesRailIcon(props: PrimaryRailIconProps) {
  return <MonitorSmartphone {...railIconProps(props.className)} />;
}
