/** @jsxImportSource react */
import * as React from "react";

import type { CloudImportedPlugin } from "../../../../app/cloud/import-state";
import type {
  DenOrgMarketplaceResolved,
  DenOrgPlugin,
  DenOrgPluginResolved,
} from "../../../../app/lib/den";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import { t } from "@/i18n";
import { ExtensionCard } from "../../../design-system/extension-card";
import { ExtensionDetailModal } from "../../../design-system/extension-detail-modal";
import { SelectMenu } from "../../../design-system/select-menu";
import { useStatusToasts } from "../../shell-feedback";
import { useCloudSession } from "../cloud/cloud-session-provider";
import type { useDenSession } from "../cloud/use-den-session";
import {
  RefreshButton,
  SettingsNotice,
  SettingsPill,
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionHeaderActions,
  SettingsSectionHeaderContent,
  SettingsSectionHeaderDescription,
  SettingsSectionHeaderTitle,
  SettingsStack,
} from "../settings-section";
import {
  SettingsListEmptyState,
  SettingsListSearchInput,
} from "../settings-list";
import { APP_NAME } from "../../../../i18n/locales/brand";

type AsyncResult = { ok: boolean; message: string };
type MarketplacePackageStatus = "available" | "installed" | "update_available";
type MarketplaceStatusFilter = "all" | MarketplacePackageStatus;
type CloudMarketplacesSession = Pick<
  ReturnType<typeof useDenSession>,
  "syncCurrentDenSettings"
>;

type DenSettingsExtensionsStore = {
  cloudOrgMarketplaces: () => DenOrgMarketplaceResolved[];
  cloudOrgMarketplacesStatus: () => string | null;
  importedCloudPlugins: () => Record<string, CloudImportedPlugin>;
  refreshCloudOrgMarketplaces: (options?: {
    force?: boolean;
  }) => Promise<unknown>;
  importCloudOrgPlugin: (
    marketplaceId: string | null,
    plugin: DenOrgPlugin,
  ) => Promise<AsyncResult>;
  removeCloudOrgPlugin: (pluginId: string) => Promise<AsyncResult>;
};

type MarketplacePackageRow = {
  marketplaceId: string;
  marketplaceName: string;
  plugin: DenOrgPlugin;
  imported: CloudImportedPlugin | null;
  status: MarketplacePackageStatus;
  counts: string[];
  composition: Array<{ count: number; label: string; type: string }>;
  searchableText: string;
};

export type CloudMarketplacesViewProps = {
  extensions: DenSettingsExtensionsStore;
  embedded?: boolean;
  session: CloudMarketplacesSession;
};

function pluginCounts(plugin: DenOrgPlugin) {
  return pluginComposition(plugin).map(
    (entry) => `${entry.count} ${entry.label}${entry.count === 1 ? "" : "s"}`,
  );
}

function pluginComposition(plugin: DenOrgPlugin) {
  return Object.entries(plugin.componentCounts).flatMap(([type, count]) => {
    if (count <= 0) return [];
    const label = type === "mcp" ? "MCP" : type;
    return [{ count, label, type }];
  });
}

function pluginStatus(
  imported: CloudImportedPlugin | null,
  plugin: DenOrgPlugin,
): MarketplacePackageStatus {
  if (!imported) return "available";
  const importedObjectCount = new Set(
    imported.files.map((file) => file.configObjectId),
  ).size;
  if (
    imported.updatedAt !== plugin.updatedAt ||
    importedObjectCount !== plugin.memberCount
  )
    return "update_available";
  return "installed";
}

function statusLabel(status: MarketplacePackageStatus) {
  switch (status) {
    case "installed":
      return t("den.imported_badge");
    case "update_available":
      return t("den.out_of_sync_badge");
    default:
      return t("settings.marketplace_available");
  }
}

function statusClass(status: MarketplacePackageStatus) {
  switch (status) {
    case "installed":
      return "border-dls-accent/30 bg-dls-accent/10 text-dls-accent";
    case "update_available":
      return "border-dls-status-warning-border bg-dls-status-warning-soft text-dls-status-warning-fg";
    default:
      return "border-dls-mist bg-dls-surface-muted text-dls-secondary";
  }
}

export function CloudMarketplacesView({
  extensions,
  embedded = false,
  session,
}: CloudMarketplacesViewProps) {
  const {
    activeOrganization: activeOrg,
    authToken,
    client,
    isSignedIn,
    user,
  } = useCloudSession();
  const { showToast } = useStatusToasts();
  const [busy, setBusy] = React.useState(false);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] =
    React.useState<MarketplaceStatusFilter>("all");
  const [marketplaceFilter, setMarketplaceFilter] = React.useState("all");
  const [detailRow, setDetailRow] =
    React.useState<MarketplacePackageRow | null>(null);
  const [resolvedPlugins, setResolvedPlugins] = React.useState<
    Record<string, DenOrgPluginResolved>
  >({});
  const [detailLoadingId, setDetailLoadingId] = React.useState<string | null>(
    null,
  );
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const activeOrgId = activeOrg?.id ?? "";

  const marketplaces = extensions.cloudOrgMarketplaces();
  const importedPlugins = extensions.importedCloudPlugins();
  const lastRowsRef = React.useRef<MarketplacePackageRow[]>([]);
  const rows = React.useMemo<MarketplacePackageRow[]>(() => {
    return marketplaces.flatMap((marketplace) =>
      marketplace.plugins.map((plugin) => {
        const imported = importedPlugins[plugin.id] ?? null;
        const composition = pluginComposition(plugin);
        const counts = pluginCounts(plugin);
        const status = pluginStatus(imported, plugin);
        return {
          marketplaceId: marketplace.marketplace.id,
          marketplaceName: marketplace.marketplace.name,
          plugin,
          imported,
          status,
          counts,
          composition,
          searchableText: [
            plugin.name,
            plugin.description ?? "",
            marketplace.marketplace.name,
            ...counts,
            ...(imported?.files.map(
              (file) => `${file.title} ${file.objectType} ${file.path}`,
            ) ?? []),
          ]
            .join(" ")
            .toLowerCase(),
        };
      }),
    );
  }, [importedPlugins, marketplaces]);

  React.useEffect(() => {
    if (rows.length > 0) lastRowsRef.current = rows;
  }, [rows]);

  const displayRows =
    rows.length > 0 ? rows : busy ? lastRowsRef.current : rows;

  const marketplaceOptions = React.useMemo(
    () =>
      marketplaces.map((marketplace) => ({
        id: marketplace.marketplace.id,
        name: marketplace.marketplace.name,
      })),
    [marketplaces],
  );

  const visibleRows = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return displayRows.filter((row) => {
      if (
        marketplaceFilter !== "all" &&
        row.marketplaceId !== marketplaceFilter
      )
        return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!query) return true;
      return row.searchableText.includes(query);
    });
  }, [displayRows, marketplaceFilter, search, statusFilter]);

  const refresh = React.useCallback(
    async (quiet = false) => {
      if (!authToken.trim() || !activeOrgId) return;

      setBusy(true);
      if (!quiet) setActionError(null);

      try {
        session.syncCurrentDenSettings();
        await extensions.refreshCloudOrgMarketplaces({ force: true });
        if (!quiet) {
          const count = extensions
            .cloudOrgMarketplaces()
            .reduce(
              (total, marketplace) => total + marketplace.plugins.length,
              0,
            );
          showToast({
            title:
              count > 0
                ? `Loaded ${count} marketplace extension${count === 1 ? "" : "s"} for ${activeOrg?.name ?? t("den.active_org_title")}.`
                : `No marketplace extensions are available for ${activeOrg?.name ?? t("den.active_org_title")}.`,
            tone: "info",
          });
        }
      } catch (error) {
        if (!quiet) {
          setActionError(
            error instanceof Error
              ? error.message
              : t("settings.marketplace_load_failed"),
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [
      extensions,
      activeOrg,
      activeOrgId,
      authToken,
      session.syncCurrentDenSettings,
      showToast,
    ],
  );

  React.useEffect(() => {
    if (!user || !activeOrgId) return;
    void refresh(true);
  }, [activeOrgId, refresh, user]);

  React.useEffect(() => {
    if (!detailRow || !isSignedIn || !activeOrgId) return;
    if (resolvedPlugins[detailRow.plugin.id]) return;

    let cancelled = false;
    setDetailLoadingId(detailRow.plugin.id);
    setDetailError(null);
    void client
      .getOrgPluginResolved(activeOrgId, detailRow.plugin)
      .then((resolved) => {
        if (cancelled) return;
        setResolvedPlugins((current) => ({
          ...current,
          [detailRow.plugin.id]: resolved,
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setDetailError(
          error instanceof Error
            ? error.message
            : t("settings.marketplace_composition_load_failed"),
        );
      })
      .finally(() => {
        if (!cancelled) setDetailLoadingId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, client, detailRow, isSignedIn, resolvedPlugins]);

  const importPlugin = React.useCallback(
    async (marketplaceId: string | null, plugin: DenOrgPlugin) => {
      if (actionId) return;

      setActionId(plugin.id);
      setActionError(null);

      try {
        const result = await extensions.importCloudOrgPlugin(
          marketplaceId,
          plugin,
        );
        if (!result.ok) throw new Error(result.message);
        showToast({
          title: `${result.message} ${t("den.reload_workspace")}`,
          tone: "success",
        });
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : `Failed to add ${plugin.name}.`,
        );
      } finally {
        setActionId(null);
      }
    },
    [actionId, extensions, showToast],
  );

  const removePlugin = React.useCallback(
    async (pluginId: string, pluginName: string) => {
      if (actionId) return;

      setActionId(pluginId);
      setActionError(null);

      try {
        const result = await extensions.removeCloudOrgPlugin(pluginId);
        if (!result.ok) throw new Error(result.message);
        showToast({ title: result.message, tone: "success" });
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : `Failed to remove ${pluginName}.`,
        );
      } finally {
        setActionId(null);
      }
    },
    [actionId, extensions, showToast],
  );

  const content = !isSignedIn ? null : (

    <SettingsSection>
      <SettingsSectionHeader>
        <SettingsSectionHeaderContent>
          <SettingsSectionHeaderTitle>
            Extension Marketplace
          </SettingsSectionHeaderTitle>
          <SettingsSectionHeaderDescription>
            Add extensions from {APP_NAME} Cloud. Claude-compatible plugins are
            normalized into {APP_NAME} extensions with installable resources
            such as skills, MCPs, commands, or tools.
          </SettingsSectionHeaderDescription>
        </SettingsSectionHeaderContent>
        <SettingsSectionHeaderActions>
          <RefreshButton
            busy={busy}
            disabled={busy || !activeOrgId}
            onRefresh={refresh}
          >
            {t("den.refresh")}
          </RefreshButton>
        </SettingsSectionHeaderActions>
      </SettingsSectionHeader>

      {(actionError ?? extensions.cloudOrgMarketplacesStatus()) ? (
        <SettingsNotice tone="error">
          {actionError ?? extensions.cloudOrgMarketplacesStatus()}
        </SettingsNotice>
      ) : null}

      {busy ? (
        <SettingsNotice>{t("settings.marketplace_loading")}</SettingsNotice>
      ) : null}

      <div className="space-y-3">
        <SettingsListSearchInput
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={t("settings.marketplace_search_placeholder")}
        />
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "available", "installed", "update_available"] as const).map(
            (filter) => (
              <Button
                key={filter}
                variant={statusFilter === filter ? "secondary" : "outline"}
                size="xs"
                onClick={() => setStatusFilter(filter)}
              >
                {filter === "all"
                  ? "All"
                  : filter === "update_available"
                    ? t("settings.marketplace_updates")
                    : filter === "installed"
                      ? "Installed"
                      : t("settings.marketplace_available")}
              </Button>
            ),
          )}
          <details className="group relative">
            <summary className="flex h-7 cursor-pointer list-none items-center rounded-md border border-dls-border px-2.5 text-xs font-medium text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text">
              Filters
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-dls-border bg-dls-surface p-3">
              <label className="grid gap-1.5 text-xs text-dls-secondary">
                {t("settings.marketplace")}
                <SelectMenu
                  ariaLabel={t("settings.marketplace")}
                  size="compact"
                  options={[
                    { value: "all", label: t("settings.all_marketplaces") },
                    ...marketplaceOptions.map((marketplace) => ({
                      value: marketplace.id,
                      label: marketplace.name,
                    })),
                  ]}
                  value={marketplaceFilter}
                  onChange={setMarketplaceFilter}
                />
              </label>
            </div>
          </details>
        </div>
      </div>

      {!busy && displayRows.length === 0 ? (
        <SettingsListEmptyState>
          {activeOrgId
            ? "No marketplace extensions are available yet."
            : "Choose an organization to view marketplace extensions."}
        </SettingsListEmptyState>
      ) : null}

      {displayRows.length > 0 && visibleRows.length === 0 ? (
        <SettingsListEmptyState>
          No marketplace extensions match your search or filters.
        </SettingsListEmptyState>
      ) : null}

      {visibleRows.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-3">
          {visibleRows.map((row) => (
            <MarketplacePackageCard
              key={`${row.marketplaceId}:${row.plugin.id}`}
              actionId={actionId}
              row={row}
              onOpenDetail={setDetailRow}
            />
          ))}
        </div>
      ) : null}

      {detailRow ? (
        <MarketplacePackageDetailModal
          actionId={actionId}
          row={detailRow}
          resolved={resolvedPlugins[detailRow.plugin.id] ?? null}
          resolving={detailLoadingId === detailRow.plugin.id}
          resolveError={detailError}
          onClose={() => setDetailRow(null)}
          onImportPlugin={importPlugin}
          onRemovePlugin={removePlugin}
        />
      ) : null}
    </SettingsSection>
  );

  return embedded ? (
    content
  ) : (
    <SettingsStack>
      <Separator />
      {content}
    </SettingsStack>
  );
}

function actionLabelForStatus(status: MarketplacePackageStatus) {
  switch (status) {
    case "installed":
      return "View details";
    case "update_available":
      return "Update available";
    default:
      return "Add";
  }
}

function MarketplacePackageCard(props: {
  actionId: string | null;
  row: MarketplacePackageRow;
  onOpenDetail: (row: MarketplacePackageRow) => void;
}) {
  const { actionId, row, onOpenDetail } = props;
  const actionBusy = actionId === row.plugin.id;

  return (
    <ExtensionCard
      name={row.plugin.name}
      description={
        row.plugin.description ||
        `Marketplace extension from ${row.marketplaceName}.`
      }
      kind="extension"
      connected={Boolean(row.imported)}
      connectedLabel="Installed"
      connecting={actionBusy}
      actionLabel={actionBusy ? "Working..." : actionLabelForStatus(row.status)}
      onClick={() => onOpenDetail(row)}
    />
  );
}

function MarketplacePackageDetailModal(props: {
  actionId: string | null;
  row: MarketplacePackageRow;
  resolved: DenOrgPluginResolved | null;
  resolving: boolean;
  resolveError: string | null;
  onClose: () => void;
  onImportPlugin: (
    marketplaceId: string | null,
    plugin: DenOrgPlugin,
  ) => void | Promise<void>;
  onRemovePlugin: (
    pluginId: string,
    pluginName: string,
  ) => void | Promise<void>;
}) {
  const {
    actionId,
    row,
    resolved,
    resolving,
    resolveError,
    onClose,
    onImportPlugin,
    onRemovePlugin,
  } = props;
  const actionBusy = actionId === row.plugin.id;
  const canAddOrUpdate =
    row.status === "available" || row.status === "update_available";

  return (
    <ExtensionDetailModal
      open
      onClose={onClose}
      name={row.plugin.name}
      description={row.plugin.description || "No description provided."}
      kind="extension"
      connected={Boolean(row.imported)}
      connectedLabel="Installed"
      connecting={actionBusy}
      connectLabel={row.status === "update_available" ? "Update" : "Add"}
      connectingLabel={
        row.status === "update_available" ? "Updating..." : "Adding..."
      }
      uninstallLabel="Remove"
      showEnablementCard={false}
      onConnect={
        canAddOrUpdate
          ? () => void onImportPlugin(row.marketplaceId, row.plugin)
          : undefined
      }
      onUninstall={
        row.imported
          ? () => void onRemovePlugin(row.plugin.id, row.plugin.name)
          : undefined
      }
      configSlot={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <SettingsPill className={statusClass(row.status)}>
              {statusLabel(row.status)}
            </SettingsPill>
            <SettingsPill>{row.marketplaceName}</SettingsPill>
            {row.counts.map((label) => (
              <SettingsPill key={label}>{label}</SettingsPill>
            ))}
          </div>
          <SettingsNotice>
            <div className="text-xs font-medium text-dls-secondary">
              Composition
            </div>
            <div className="mt-2 grid gap-2">
              {row.composition.map((entry) => (
                <div
                  key={entry.type}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="capitalize text-dls-text">
                    {entry.label}
                  </span>
                  <CountBadge size="compact" className="bg-dls-surface text-dls-secondary">
                    {entry.count}
                  </CountBadge>
                </div>
              ))}
            </div>
          </SettingsNotice>
          {resolveError ? (
            <SettingsNotice tone="error">{resolveError}</SettingsNotice>
          ) : null}
          {resolving ? (
            <SettingsNotice>{t("settings.marketplace_loading_contents")}</SettingsNotice>
          ) : null}
          {resolved ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-dls-secondary">
                Extension contents
              </div>
              {resolved.memberships.length > 0 ? (
                resolved.memberships.map((membership) => {
                  const object = membership.configObject;
                  const version = object?.latestVersion ?? null;
                  if (!object) return null;
                  const preview =
                    version?.rawSourceText?.trim().slice(0, 600) ?? "";
                  return (
                    <details
                      key={membership.id}
                      className="rounded-xl border border-dls-border bg-dls-surface px-3 py-2"
                    >
                      <summary className="cursor-pointer text-sm font-medium text-dls-text">
                        <span className="text-xs text-dls-secondary">
                          {object.objectType}
                        </span>{" "}
                        {object.title}
                      </summary>
                      <div className="mt-2 space-y-2 text-xs text-dls-secondary">
                        {object.description ? (
                          <div>{object.description}</div>
                        ) : null}
                        {object.currentRelativePath ? (
                          <div className="font-mono">
                            {object.currentRelativePath}
                          </div>
                        ) : null}
                        {preview ? (
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-dls-hover p-2 font-mono text-xs text-dls-text">
                            {preview}
                          </pre>
                        ) : null}
                      </div>
                    </details>
                  );
                })
              ) : (
                <SettingsNotice>
                  This extension does not expose detailed contents yet.
                </SettingsNotice>
              )}
            </div>
          ) : null}
          {row.imported?.files.length ? (
            <SettingsNotice>
              Installed files:{" "}
              {row.imported.files
                .map((file) => `${file.title} (${file.objectType})`)
                .join(", ")}
            </SettingsNotice>
          ) : null}
        </div>
      }
    />
  );
}
