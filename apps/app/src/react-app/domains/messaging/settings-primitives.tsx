/** @jsxImportSource react */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared layout primitives for messaging channel settings panels
 * (weixin / feishu / token-based channels). Keep these presentational only —
 * no IPC, no channel-specific state.
 */

export function PanelSection(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Full-width cards can put actions on the title row; stacked cards keep them below to avoid CJK wrap. */
  headerLayout?: "stack" | "inline";
  "data-testid"?: string;
}) {
  const inline = props.headerLayout === "inline";
  return (
    <section
      data-testid={props["data-testid"]}
      className={cn(
        // h-full keeps cards in each responsive row aligned without forcing a fixed height.
        "flex h-full min-w-0 flex-col gap-3 rounded-xl border border-dls-border bg-dls-surface p-4",
        props.className,
      )}
    >
      <div
        className={cn(
          "min-w-0",
          inline
            ? "flex items-start justify-between gap-3"
            : "space-y-2",
        )}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium leading-5 text-dls-text break-words">
            {props.title}
          </div>
          {props.description ? (
            <p className="mt-1 text-xs leading-5 text-dls-secondary break-words">
              {props.description}
            </p>
          ) : null}
        </div>
        {props.actions ? (
          <div className={cn("flex flex-wrap items-center gap-1.5", inline && "shrink-0")}>
            {props.actions}
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">{props.children}</div>
    </section>
  );
}

export function FieldLabel(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs text-dls-secondary">
      <span className="font-medium text-dls-secondary">{props.label}</span>
      {props.children}
      {props.hint ? (
        <span className="text-xs leading-4 text-dls-secondary/90">{props.hint}</span>
      ) : null}
    </label>
  );
}

export function MetricInline(props: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      <span className="shrink-0 text-dls-secondary">{props.label}</span>
      <span className="truncate font-medium tabular-nums text-dls-text">{props.value}</span>
    </span>
  );
}

export function SettingsCardGrid(props: {
  channel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="messaging-settings-card-grid"
      data-settings-card-grid={props.channel}
      className={cn(
        "grid min-w-0 gap-4 lg:grid-cols-2",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}
