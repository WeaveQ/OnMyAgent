/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

import type { AutomationCreateResultRow } from "./expert-automation-offer-flow";

export function AutomationCreateResultCard(props: {
  rows: readonly AutomationCreateResultRow[];
  onView: (row: AutomationCreateResultRow) => void;
  onDismiss?: () => void;
}) {
  if (props.rows.length === 0) return null;

  return (
    <div className="border-b border-dls-border bg-dls-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-dls-text">
          {t("session.automation_result_title", { count: props.rows.length })}
        </div>
        {props.onDismiss ? (
          <Button type="button" variant="ghost" size="sm" onClick={props.onDismiss}>
            {t("session.automation_result_dismiss")}
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-dls-border">
        <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
          <thead className="bg-dls-surface-muted text-xs text-dls-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t("session.automation_result_col_name")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("session.automation_result_col_prompt")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("session.automation_result_col_action")}
              </th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.id} className="border-t border-dls-border align-top">
                <td className="px-3 py-2 font-medium text-dls-text">{row.title}</td>
                <td className="max-w-xs px-3 py-2 text-dls-secondary">
                  <span className="line-clamp-3 whitespace-pre-wrap break-words">
                    {row.prompt}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => props.onView(row)}
                  >
                    {t("session.automation_result_view")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
