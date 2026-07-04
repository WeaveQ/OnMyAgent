/** @jsxImportSource react */
import { Loader2 } from "lucide-react";

import { StatusDot } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { SelectMenu } from "../../design-system/select-menu";
import type { PersonalLocalAgentAcpConfigOptionValue } from "../../../app/lib/desktop";

export type LocalAgentAcpConfigOption = {
  id: string;
  label: string;
  type: "select" | "boolean" | "string";
  value: PersonalLocalAgentAcpConfigOptionValue;
  options: Array<{ value: string; label: string }>;
};

export function AcpConfigOptionEditor(props: {
  option: LocalAgentAcpConfigOption;
  value: PersonalLocalAgentAcpConfigOptionValue;
  busy: boolean;
  disabled: boolean;
  onChange: (value: PersonalLocalAgentAcpConfigOptionValue) => void;
}) {
  const currentValue = props.value ?? props.option.value;
  if (props.option.type === "select") {
    return (
      <label className="flex min-w-[180px] flex-[1_1_220px] items-center gap-2 text-xs text-dls-secondary">
        <span className="shrink-0 whitespace-nowrap">{props.option.label}</span>
        <div className="min-w-0 flex-1">
          <SelectMenu size="compact" ariaLabel={props.option.label} options={props.option.options.length ? props.option.options : [{ value: "", label: t("local_agent.config_option_no_values") }]} value={String(currentValue ?? "")} onChange={props.onChange} disabled={props.disabled || props.busy || props.option.options.length === 0} />
        </div>
      </label>
    );
  }
  if (props.option.type === "boolean") {
    const checked = Boolean(currentValue);
    return (
      <button type="button" className={cn("flex min-h-9 min-w-[160px] items-center justify-between gap-2 rounded-lg border border-dls-border bg-dls-surface px-2 text-xs text-dls-text transition-colors hover:border-dls-border-strong disabled:cursor-not-allowed disabled:opacity-60", checked && "border-dls-accent/40 bg-dls-accent/5")} disabled={props.disabled || props.busy} aria-pressed={checked} onClick={() => props.onChange(!checked)}>
        <span className="min-w-0 truncate">{props.option.label}</span>
        {props.busy ? <Loader2 className="size-3.5 animate-spin text-dls-secondary" /> : <StatusDot size="sm" tone={checked ? "active" : "muted"} />}
      </button>
    );
  }
  return (
    <label className="flex min-w-[220px] flex-[1_1_260px] items-center gap-2 text-xs text-dls-secondary">
      <span className="shrink-0 whitespace-nowrap">{props.option.label}</span>
      <input className="min-h-9 min-w-0 flex-1 rounded-lg border border-dls-border bg-dls-surface px-2 text-xs text-dls-text outline-none transition-colors focus:border-dls-accent/60 focus:ring-2 focus:ring-dls-accent/15 disabled:cursor-not-allowed disabled:opacity-60" value={String(currentValue ?? "")} disabled={props.disabled || props.busy} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}
