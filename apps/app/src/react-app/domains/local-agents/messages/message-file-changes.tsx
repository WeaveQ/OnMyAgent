/** @jsxImportSource react */
import { FilePenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { openDesktopPath } from "../../../../app/lib/desktop";
import type { PersonalLocalAgentRunFileChange } from "../../../../app/lib/desktop-types";
import { localAgentLayoutClass, localAgentTextClass } from "./message-style";

type Props = {
  fileChanges: PersonalLocalAgentRunFileChange[];
  onFeedback?: (id: string, kind: "ok" | "error", message: string) => void;
};

// HR2-A-03: renderer surface for tool-call file edits. Mirrors Upstream's
// MessageFileChanges component. Read-only: opens the file in the OS default
// application via the shared openDesktopPath IPC.
export function MessageFileChanges({ fileChanges, onFeedback }: Props) {
  if (!fileChanges.length) return null;
  const seen = new Set<string>();
  const rows = fileChanges.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  const handleOpen = async (entry: PersonalLocalAgentRunFileChange): Promise<void> => {
    try {
      await openDesktopPath(entry.filePath);
      onFeedback?.(entry.id, "ok", t("local_agent.opened_name", { name: entry.fileName }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onFeedback?.(entry.id, "error", t("local_agent.open_failed", { message }));
    }
  };
  return (
    <div className={localAgentLayoutClass.artifactPanel}>
      <div className={localAgentTextClass.artifactTitle}>
        <FilePenLine className="size-3.5" />
        {t("local_agent.file_changes_title", { count: rows.length })}
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((entry) => (
          <Button
            key={entry.id}
            type="button"
            variant="ghost"
            size="xs"
            className={localAgentLayoutClass.artifactButton}
            title={t("local_agent.open_file_change", { name: entry.fileName, tool: entry.tool })}
            onClick={() => void handleOpen(entry)}
          >
            <FilePenLine className="size-3.5 shrink-0" />
            <span className="truncate">{entry.fileName}</span>
            <span className="ml-1 shrink-0 text-xs uppercase tracking-wide text-dls-secondary">{entry.tool}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
