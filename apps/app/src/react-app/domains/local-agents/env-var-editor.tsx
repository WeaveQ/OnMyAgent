/** @jsxImportSource react */
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export type EnvVarRow = {
  name: string;
  value: string;
};

export function EnvVarEditor(props: {
  rows: EnvVarRow[];
  disabled?: boolean;
  onChange: (rows: EnvVarRow[]) => void;
}) {
  const update = (index: number, row: EnvVarRow) => props.onChange(props.rows.map((item, current) => current === index ? row : item));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-dls-secondary">{t("local_agent.editor_env")}</div>
        <Button type="button" variant="outline" size="sm" disabled={props.disabled} onClick={() => props.onChange([...props.rows, { name: "", value: "" }])}>
          <Plus className="mr-1.5 size-3.5" />{t("common.add")}
        </Button>
      </div>
      {props.rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
          <input className="min-h-9 rounded-lg border border-dls-border bg-dls-surface px-2 text-sm text-dls-text" placeholder={t("local_agent.editor_env_name")} value={row.name} disabled={props.disabled} onChange={(event) => update(index, { ...row, name: event.target.value })} />
          <input className="min-h-9 rounded-lg border border-dls-border bg-dls-surface px-2 text-sm text-dls-text" placeholder={t("local_agent.editor_env_value")} value={row.value} disabled={props.disabled} onChange={(event) => update(index, { ...row, value: event.target.value })} />
          <Button type="button" variant="outline" size="icon-sm" disabled={props.disabled} aria-label={t("common.delete")} onClick={() => props.onChange(props.rows.filter((_, current) => current !== index))}>
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
