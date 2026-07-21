/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import {
  personalLocalAgentListExtensions,
  personalLocalAgentSetExtensionEnabled,
  type PersonalLocalAgentExtensionInfo,
} from "../../../app/lib/desktop";

// Read-only view of extension-contributed ACP adapters. Users can only toggle
// enabled/disabled here; adding new extensions is a filesystem drop-in for now.
export function ExtensionListPanel() {
  const [extensions, setExtensions] = useState<PersonalLocalAgentExtensionInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingName, setTogglingName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await personalLocalAgentListExtensions();
      setExtensions(result.extensions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = useCallback(async (info: PersonalLocalAgentExtensionInfo, next: boolean) => {
    setTogglingName(info.name);
    setError(null);
    try {
      await personalLocalAgentSetExtensionEnabled({ name: info.name, enabled: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingName(null);
    }
  }, [load]);

  return (
    <section className="space-y-3" data-testid="local-agent-extensions-panel">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-dls-text">{t("local_agent.extensions_title")}</h3>
        <span className="text-xs text-dls-secondary">{t("local_agent.extensions_count", { count: extensions.length })}</span>
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={"mr-1.5 size-3.5" + (busy ? " animate-spin" : "")} />
          {t("common.refresh")}
        </Button>
      </div>
      {error ? <NoticeBox tone="error">{error}</NoticeBox> : null}
      {busy && extensions.length === 0 ? (
        <div
          className="flex min-h-16 items-center justify-center gap-2 text-sm text-dls-secondary"
          role="status"
          aria-label={t("common.loading")}
        >
          <LoadingSpinner size="sm" />
          <span>{t("common.loading")}</span>
        </div>
      ) : extensions.length === 0 ? (
        <EmptyStateBox size="compact" className="text-xs">
          {t("local_agent.extensions_empty")}
        </EmptyStateBox>
      ) : (
        <ul className="space-y-2">
          {extensions.map((ext) => (
            <li key={ext.name} className="rounded-lg border border-dls-border bg-dls-surface p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-dls-text">
                    <span>{ext.displayName || ext.name}</span>
                    <StatusBadge tone="neutral" shape="soft" size="tiny" className="uppercase">
                      {ext.source}
                    </StatusBadge>
                    <span className="text-2xs text-dls-secondary">v{ext.version}</span>
                  </div>
                  {ext.description ? <p className="text-xs text-dls-secondary">{ext.description}</p> : null}
                  <p className="text-xs text-dls-secondary">
                    {t("local_agent.extensions_adapters", { count: ext.adapterIds.length })}
                    {ext.adapterIds.length ? `: ${ext.adapterIds.join(", ")}` : ""}
                  </p>
                  {ext.errors.length ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-dls-danger">
                      {ext.errors.map((entry, index) => (<li key={index}>{entry.message}</li>))}
                    </ul>
                  ) : null}
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-dls-secondary">
                  <input
                    type="checkbox"
                    checked={ext.enabled}
                    disabled={togglingName === ext.name || busy}
                    onChange={(event) => void handleToggle(ext, event.target.checked)}
                    data-testid={`local-agent-extension-toggle-${ext.name}`}
                  />
                  <span>{ext.enabled ? t("local_agent.extensions_enabled") : t("local_agent.extensions_disabled")}</span>
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
