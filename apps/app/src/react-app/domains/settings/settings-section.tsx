/** @jsxImportSource react */
import type * as React from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoticeBox, type NoticeBoxSize, type NoticeBoxTone } from "@/components/ui/notice-box";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SettingsTone = "ready" | "warning" | "neutral" | "error";

export interface SpinnerProps {
  className?: string;
  size?: number;
  spinning?: boolean;
}

export function Spinner({
  className,
  size = 13,
  spinning = true,
}: SpinnerProps) {
  return <RefreshCcw size={size} className={cn(spinning && "animate-spin", className)} />;
}

export interface RefreshButtonProps extends Omit<React.ComponentProps<typeof Button>, "onClick"> {
  busy: boolean;
  onRefresh: () => void | Promise<void>;
}

export function RefreshButton({
  busy,
  children,
  className,
  onRefresh,
  ...props
}: RefreshButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground", className)}
            onClick={() => void onRefresh()}
            {...props}
          >
            <span className="sr-only">{children}</span>
            <Spinner className="size-3.5" spinning={busy} />
          </Button>
        )}
      />
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

export interface SettingsLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsStack({ children, className }: SettingsLayoutProps) {
  return <div className={cn("@container/settings flex w-full max-w-3xl flex-col gap-y-6", className)}>{children}</div>;
}

interface SettingsSectionProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({ children, className }: SettingsSectionProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {children}
    </div>
  );
}

interface SettingsInsetProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsInset({ children, className }: SettingsInsetProps) {
  return (
    <div className={cn("border border-dls-border rounded-2xl p-4", className)}>
      {children}
    </div>
  );
}

export interface SettingsCardProps extends SettingsLayoutProps {
  size?: "default" | "compact";
  tone?: "muted" | "surface";
}

export function SettingsCard({ children, className, size = "default", tone = "muted" }: SettingsCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border",
        tone === "muted" ? "border-dls-border/50 bg-dls-surface-muted/30" : "border-dls-border/60 bg-dls-surface/40",
        size === "default" ? "p-5" : "p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SettingsPanelProps extends SettingsLayoutProps {
  size?: "default" | "comfortable";
  tone?: "surface" | "soft";
}

export function SettingsPanel({ children, className, size = "default", tone = "surface" }: SettingsPanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border",
        tone === "surface" ? "border-dls-border bg-dls-surface" : "border-dls-border/70 bg-dls-surface/60",
        size === "default" ? "p-4" : "p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SettingsPillProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsPill({ children, className }: SettingsPillProps) {
  return (
    <StatusBadge className={className} size="default" tone="neutral">
      {children}
    </StatusBadge>
  );
}

export interface SettingsStatusBadgeProps {
  label: string;
  tone: SettingsTone;
  className?: string;
}

function settingsStatusTone(tone: SettingsTone): StatusBadgeTone {
  if (tone === "ready") return "accent";
  if (tone === "warning") return "warning";
  if (tone === "error") return "danger";
  return "neutral";
}

export function SettingsStatusBadge({ label, tone, className }: SettingsStatusBadgeProps) {
  return (
    <StatusBadge className={cn("gap-2", className)} size="default" tone={settingsStatusTone(tone)}>
      <StatusDot size="md" tone="current" />
      {label}
    </StatusBadge>
  );
}

export interface SettingsNoticeProps extends SettingsLayoutProps {
  tone?: NoticeBoxTone;
  size?: NoticeBoxSize;
}

export function SettingsNotice({
  children,
  tone = "neutral",
  size = "default",
  className,
}: SettingsNoticeProps) {
  return <NoticeBox className={className} size={size} tone={tone}>{children}</NoticeBox>;
}

export interface SettingsActionRowProps extends SettingsLayoutProps {
  align?: "center" | "start";
  as?: "div" | "li";
  density?: "default" | "compact";
}

export function SettingsActionRow({ children, className, align = "center", as = "div", density = "default" }: SettingsActionRowProps) {
  const rowClassName = cn(
    "flex justify-between gap-3 border border-dls-border bg-dls-surface",
    density === "default" ? "rounded-xl p-3" : "rounded-lg px-3 py-2.5",
    align === "center" ? "items-center" : "items-start",
    className,
  );

  if (as === "li") {
    return <li className={rowClassName}>{children}</li>;
  }

  return <div className={rowClassName}>{children}</div>;
}

export type SectionItemHeaderProps = SettingsLayoutProps;

export function SettingsSectionHeader({ children, className }: SectionItemHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-start justify-between", className)}>
      {children}
    </div>
  );
}

interface SectionItemHeaderContentProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsSectionHeaderContent({ children, className }: SectionItemHeaderContentProps) {
  return <div className={cn("flex flex-col gap-1", className)}>{children}</div>;
}

interface SettingsItemHeaderTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsSectionHeaderTitle({ children, className }: SettingsItemHeaderTitleProps) {
  return (
    <div className={cn("flex items-center gap-2 text-base font-medium text-dls-text", className)}>
      {children}
    </div>
  );
}

interface SectionItemHeaderDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsSectionHeaderDescription({ children, className }: SectionItemHeaderDescriptionProps) {
  return <div className={cn("text-sm text-muted-foreground", className)}>{children}</div>;
}


interface SectionItemHintProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsSectionHint({ children, className }: SectionItemHintProps) {
  return <div className={cn("text-xs text-muted-foreground", className)}>{children}</div>;
}

interface SectionItemHeaderActionsProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsSectionHeaderActions({ children, className }: SectionItemHeaderActionsProps) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
