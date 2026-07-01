/** @jsxImportSource react */
import type * as React from "react";
import { RefreshCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type SettingsContentProps = {
  children: React.ReactNode;
};

export function SettingsContent(props: SettingsContentProps) {
  return (
    <div className="min-w-0 min-h-0 flex-1 overflow-y-auto flex flex-col gap-6 p-4 md:gap-8 md:p-6 lg:p-8 items-center">
      {props.children}
    </div>
  );
}

export function SettingsPanelContent(props: SettingsContentProps) {
  return (
    <div className="min-w-0 min-h-0 flex-1 overflow-y-auto flex flex-col gap-6 px-4 pt-5 pb-12 md:gap-8 md:px-10 md:pt-6 lg:px-16 lg:pt-8 items-center">
      {props.children}
    </div>
  );
}

type SettingsPanelHeaderProps = {
  children: React.ReactNode;
};

export function SettingsPanelHeader(props: SettingsPanelHeaderProps) {
  return (
    <div className="shrink-0 px-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-8">
      {props.children}
    </div>
  );
}

type SettingsPanelProps = {
  children: React.ReactNode;
};

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <div
      className={cn(
        "mx-auto mb-5 flex w-full max-w-3xl flex-col gap-3 px-4 md:flex-row md:justify-between md:px-10 lg:px-16",
      )}
    >
      {props.children}
    </div>
  );
}

type SettingsPanelHeadingProps = {
  children: React.ReactNode;
  className?: string;
};

export function SettingsPanelHeading(props: SettingsPanelHeadingProps) {
  return (
    <div className={cn("flex flex-col gap-y-1", props.className)}>
      {props.children}
    </div>
  );
}

type SettingsPanelTitleProps = {
  children: React.ReactNode;
  className?: string;
};

export function SettingsPanelTitle(props: SettingsPanelTitleProps) {
  return (
    <h2 className={cn("text-lg font-medium", props.className)}>
      {props.children}
    </h2>
  );
}

type SettingsPanelDescriptionProps = {
  children: React.ReactNode;
};

export function SettingsPanelDescription(props: SettingsPanelDescriptionProps) {
  return <p className="text-sm text-muted-foreground">{props.children}</p>;
}

type SettingsPanelToolbarProps = {
  children: React.ReactNode;
};

export function SettingsPanelToolbar(props: SettingsPanelToolbarProps) {
  return (
    <div className="mt-4 flex flex-col gap-y-2 md:mt-0 md:max-w-sm md:text-right">
      {props.children}
    </div>
  );
}

type SettingsPanelToolbarActionsProps = {
  children: React.ReactNode;
};

export function SettingsPanelToolbarActions(
  props: SettingsPanelToolbarActionsProps,
) {
  return (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      {props.children}
    </div>
  );
}

type SettingsPanelToolbarStatusProps = {
  tone?: string;
  title?: string;
  spinning?: boolean;
  children: React.ReactNode;
};

export function SettingsPanelToolbarStatus(
  props: SettingsPanelToolbarStatusProps,
) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
        props.tone ?? "bg-dls-active/60 text-dls-secondary border-dls-border/50",
      )}
      title={props.title}
    >
      {props.spinning ? (
        <RefreshCcw size={12} className="animate-spin" />
      ) : null}
      <span className="tabular-nums whitespace-nowrap">{props.children}</span>
    </div>
  );
}

type SettingsPanelToolbarButtonProps = {
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
};

export function SettingsPanelToolbarButton(
  props: SettingsPanelToolbarButtonProps,
) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {props.children}
    </Button>
  );
}

type SettingsPanelToolbarMessageProps = {
  children: React.ReactNode;
};

export function SettingsPanelToolbarMessage(
  props: SettingsPanelToolbarMessageProps,
) {
  return (
    <div className="text-xs leading-relaxed text-dls-status-warning/90 md:max-w-sm">
      {props.children}
    </div>
  );
}
