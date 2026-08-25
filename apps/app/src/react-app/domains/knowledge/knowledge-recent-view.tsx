/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";

import {
  listKnowledgeRecent,
  recordKnowledgeRecentAccess,
  type KnowledgeRecentEntry,
} from "../../../app/lib/desktop-knowledge";
import { t } from "../../../i18n";
import type { KnowledgeNoteRef, KnowledgeVaultScope } from "./knowledge-vault-model";

export type KnowledgeRecentViewProps = {
  /** Open a note using the host's existing editor/tab flow. */
  onOpenNote: (note: KnowledgeNoteRef) => void | Promise<void>;
  /**
   * Resolve a human scope/folder label for an entry. Implementers typically
   * return the localized scope (Personal / Project / Expert) when `location`
   * is empty, otherwise `location` (the posix folder within the vault).
   */
  scopeFor: (entry: KnowledgeRecentEntry) => string;
  /** Optional cap; defaults to the desktop-side list (100 MRU). */
  limit?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Relative-time formatter for the recent list. Reuses the shared `time.*`
 * keys and adds a day bucket (the shared helper falls straight to an
 * absolute date after hours).
 */
export function formatRecentAccessed(accessedAt: string, nowMs: number = Date.now()): string {
  const ts = Date.parse(accessedAt);
  if (!Number.isFinite(ts)) return "";
  const delta = nowMs - ts;
  if (delta < 0) return t("time.just_now");
  if (delta < 60_000) {
    return t("time.seconds_ago", { count: Math.max(1, Math.round(delta / 1000)) });
  }
  if (delta < 60 * 60_000) {
    return t("time.minutes_ago", { count: Math.max(1, Math.round(delta / 60_000)) });
  }
  if (delta < DAY_MS) {
    return t("time.hours_ago", { count: Math.max(1, Math.round(delta / (60 * 60_000))) });
  }
  if (delta < 7 * DAY_MS) {
    return t("time.days_ago", { count: Math.max(1, Math.round(delta / DAY_MS)) });
  }
  return new Date(ts).toLocaleDateString();
}

export function KnowledgeRecentView({ onOpenNote, scopeFor, limit }: KnowledgeRecentViewProps) {
  const [entries, setEntries] = useState<KnowledgeRecentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await listKnowledgeRecent(limit ? { limit } : undefined);
      if (result?.ok) {
        setEntries(Array.isArray(result.entries) ? result.entries : []);
      }
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleOpen = useCallback(
    async (entry: KnowledgeRecentEntry) => {
      const note: KnowledgeNoteRef = {
        scope: entry.scope as KnowledgeVaultScope,
        relPath: entry.relPath,
      };
      // Best-effort: record access, then open. Never block opening on IPC.
      try {
        await recordKnowledgeRecentAccess(note);
      } catch {
        // ignore; the list will refresh on next mount
      }
      await onOpenNote(note);
      void refresh();
    },
    [onOpenNote, refresh],
  );

  if (loading) {
    return <div className="px-3 py-6 text-sm text-dls-secondary" aria-busy="true" />;
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <FileText className="size-6 text-dls-muted" aria-hidden="true" />
        <p className="text-sm text-dls-secondary">{t("knowledge.recent_empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" role="group" aria-label={t("knowledge.recent_title")}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-b border-dls-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-dls-secondary">
        <span>{t("knowledge.recent_name")}</span>
        <span>{t("knowledge.recent_location")}</span>
        <span>{t("knowledge.recent_accessed")}</span>
      </div>
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.key}>
            <button
              type="button"
              onClick={() => void handleOpen(entry)}
              className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-dls-border/60 px-3 py-2 text-start text-sm transition-colors hover:bg-dls-surface-muted/60 focus-visible:bg-dls-surface-muted/60 focus-visible:outline-none"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-dls-muted" aria-hidden="true" />
                <span className="truncate text-dls-text" title={entry.name}>
                  {entry.name}
                </span>
              </span>
              <span className="truncate text-dls-secondary" title={scopeFor(entry)}>
                {scopeFor(entry)}
              </span>
              <span className="whitespace-nowrap text-xs text-dls-secondary">
                {formatRecentAccessed(entry.accessedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
