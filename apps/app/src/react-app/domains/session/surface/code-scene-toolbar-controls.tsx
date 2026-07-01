/** @jsxImportSource react */
import type { ReactNode } from "react";
import type { Code2 } from "lucide-react";

export function diffLineClass(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-dls-status-success-soft text-dls-status-success-fg";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-dls-status-danger-soft text-dls-status-danger-fg";
  }
  if (line.startsWith("@@")) return "bg-dls-decision-soft text-dls-accent";
  return "text-dls-text";
}

export function CodeChangeCount(props: { additions: number; deletions: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
      <span className="text-dls-status-success-fg">+{props.additions}</span>
      <span className="text-dls-status-danger-fg">-{props.deletions}</span>
    </span>
  );
}

export function CodeEnvironmentButton(props: {
  icon: typeof Code2;
  label: string;
  trailing?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex min-h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium text-dls-text hover:bg-dls-hover disabled:cursor-default disabled:text-dls-secondary"
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.trailing ? (
        <span className="shrink-0 text-dls-secondary">{props.trailing}</span>
      ) : null}
    </button>
  );
}

export function CodeMenuRow(props: {
  icon: typeof Code2;
  label: string;
  trailing?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex min-h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-dls-text hover:bg-dls-hover disabled:text-dls-secondary"
    >
      <Icon className="size-4 shrink-0 text-dls-secondary" />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.trailing ? <span className="shrink-0">{props.trailing}</span> : null}
    </button>
  );
}
