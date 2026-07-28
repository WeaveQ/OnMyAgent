/** @jsxImportSource react */
/**
 * First-screen card skeleton for cold boot (assistant / expert / session page).
 */
import { STARTUP_SKELETON_ROWS } from "../chat/session-page-model";

export function SessionStartupSkeleton() {
  return (
    <div className="px-6 py-14" role="status" aria-live="polite">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded-full bg-dls-surface-muted" />
          <div className="h-3 w-64 animate-pulse rounded-full bg-dls-surface-muted" />
        </div>
        <div className="space-y-3">
          {STARTUP_SKELETON_ROWS.map((row) => (
            <div
              key={row.id}
              className="rounded-xl border border-dls-border bg-dls-surface-muted p-4"
            >
              <div
                className="mb-3 h-3 animate-pulse rounded-full bg-dls-surface-muted"
                style={{ width: row.titleWidth }}
              />
              <div className="space-y-2">
                <div className="h-2.5 animate-pulse rounded-full bg-dls-surface-muted" />
                <div
                  className="h-2.5 animate-pulse rounded-full bg-dls-surface-muted"
                  style={{ width: row.bodyWidth }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
