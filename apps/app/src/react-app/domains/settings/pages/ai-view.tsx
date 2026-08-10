/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown, ChevronUp, FileCode, Pencil, Trash2, Unplug } from "lucide-react";
import { useState, type ReactNode } from "react";

import { t } from "@/i18n";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { ProviderIcon } from "../../../design-system/provider-icon";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsNotice,
  SettingsStatusBadge,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";
import { AiSettingsProvidersSkeleton } from "./ai-providers-skeleton";

export { AiSettingsProvidersSkeleton } from "./ai-providers-skeleton";

export type AiSettingsConnectedProvider = {
  id: string;
  name: string;
  source?: "env" | "api" | "config" | "custom";
  managedBy?: "opencode";
  /**
   * Model count when known. Omit / undefined while still resolving so the row
   * can paint without waiting on catalog size.
   */
  modelCount?: number;
};

export type AiSettingsViewProps = {
  busy: boolean;
  providerAuthBusy: boolean;
  providerStatusLabel: string;
  providerStatusStyle: string;
  providerSummary: string;
  providerConnected: boolean;
  connectedProviders: AiSettingsConnectedProvider[];
  disconnectingProviderId: string | null;
  providerConnectError: string | null;
  providerDisconnectStatus: string | null;
  providerDisconnectError: string | null;
  onOpenProviderAuth: () => void | Promise<void>;
  onDisconnectProvider: (providerId: string) => void | Promise<void>;
  canDisconnectProvider: (provider: AiSettingsConnectedProvider) => boolean;
  /** Set of local provider IDs that were imported from cloud. */
  cloudProviderIds?: Set<string>;
  showOnMyAgentModelsSubscribe?: boolean;
  onSubscribeOnMyAgentModels?: () => void | Promise<void>;
  cloudProvidersView?: ReactNode;
  onOpenOpencodeConfig?: () => void | Promise<void>;
  onEditProvider?: (provider: AiSettingsConnectedProvider) => void;
  onDeleteProvider?: (provider: AiSettingsConnectedProvider) => void;
  canEditProvider?: (provider: AiSettingsConnectedProvider) => boolean;
  canDeleteProvider?: (provider: AiSettingsConnectedProvider) => boolean;
  /** Provider id currently being edited/deleted (disables its row actions). */
  providerActionBusyId?: string | null;
  /**
   * True while a save/delete is applying engine config and refreshing the
   * provider catalog (the short "cache" window after write succeeds).
   */
  providerSyncBusy?: boolean;
  /**
   * True when the workspace OpenCode client is available. Official provider
   * connect needs this; custom OpenCode config can still be edited offline.
   */
  runtimeConnected?: boolean;
  /**
   * Waiting on OpenCode provider.list (first paint of the connected list).
   * Shows list skeletons instead of a bare empty state.
   */
  providersLoading?: boolean;
  /**
   * List is shown; custom OpenCode inventory is still merging in the background.
   */
  inventorySyncing?: boolean;
  /**
   * Move a connected provider one step in the list (persisted order).
   * Prefer buttons over HTML5 drag for keyboard / Windows touch accessibility.
   */
  onMoveProvider?: (providerId: string, direction: "up" | "down") => void;
};

function providerSourceLabel(source?: AiSettingsConnectedProvider["source"]) {
  if (source === "env") return t("settings.provider_source_env");
  if (source === "api") return t("providers.api_key_label");
  if (source === "config") return t("settings.provider_source_config");
  if (source === "custom") return t("settings.provider_source_custom");
  return null;
}

function providerStatusTone(
  label: string,
  isConnected: boolean,
): "ready" | "warning" | "neutral" {
  if (isConnected) return "ready";
  const lower = label.toLowerCase();
  if (
    lower.includes("error") ||
    lower.includes("fail") ||
    lower.includes("\u5931\u8D25") ||
    lower.includes("\u9519\u8BEF")
  )
    return "warning";
  // "未配置" / not configured / loading — calm neutral, not danger.
  return "neutral";
}

export function AiSettingsView(props: AiSettingsViewProps) {
  const syncBusy = props.providerSyncBusy === true;
  const providersLoading = props.providersLoading === true;
  const inventorySyncing = props.inventorySyncing === true;
  const actionsDisabled = props.busy || syncBusy;
  const runtimeConnected = props.runtimeConnected !== false;
  // Custom config stays available while the list is still hydrating.
  const connectDisabled =
    actionsDisabled || props.providerAuthBusy || !runtimeConnected;
  const [pendingDelete, setPendingDelete] =
    useState<AiSettingsConnectedProvider | null>(null);
  const showListSkeleton =
    providersLoading && props.connectedProviders.length === 0;

  if (showListSkeleton) {
    return <AiSettingsProvidersSkeleton />;
  }

  return (
    <LayoutStack>
      <div className="flex w-full max-w-3xl flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-dls-text">
              {props.providerSummary}
            </span>
            <SettingsStatusBadge
              tone={providerStatusTone(
                props.providerStatusLabel,
                props.providerConnected,
              )}
              label={props.providerStatusLabel}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void props.onOpenOpencodeConfig?.()}
              disabled={props.busy}
            >
              {syncBusy ? (
                <LoadingSpinner size="sm" className="size-3.5" />
              ) : (
                <FileCode className="size-3.5" />
              )}
              {t("settings.custom_provider_config")}
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <span className="inline-flex">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void props.onOpenProviderAuth()}
                      disabled={connectDisabled}
                    >
                      {props.providerAuthBusy
                        ? t("system.load_settings_ai")
                        : t("settings.connect_provider")}
                    </Button>
                  </span>
                )}
              />
              {!runtimeConnected ? (
                <TooltipContent className="max-w-xs">
                  {t("settings.connect_provider_runtime_required")}
                </TooltipContent>
              ) : null}
            </Tooltip>
          </div>
        </div>

        {syncBusy ? (
          <SettingsNotice>
            <span className="inline-flex items-center gap-2">
              <LoadingSpinner size="sm" className="size-3.5 shrink-0" />
              {t("settings.custom_provider_syncing")}
            </span>
          </SettingsNotice>
        ) : null}

        {inventorySyncing && !syncBusy ? (
          <SettingsNotice>
            <span className="inline-flex items-center gap-2">
              <LoadingSpinner size="sm" className="size-3.5 shrink-0" />
              {t("settings.loading_providers_inventory")}
            </span>
          </SettingsNotice>
        ) : null}

        {!runtimeConnected && !syncBusy ? (
          <SettingsNotice tone="warning">
            {t("settings.connect_provider_runtime_required_short")}
          </SettingsNotice>
        ) : null}

        <SettingsBlock>
          {props.connectedProviders.length > 0 ? (
            props.connectedProviders.map((provider, providerIndex) => {
              const sourceLabel = providerSourceLabel(provider.source);
              const isCloud = props.cloudProviderIds?.has(provider.id) === true;
              const rowBusy =
                syncBusy || props.providerActionBusyId === provider.id;
              const modelCount =
                typeof provider.modelCount === "number" &&
                provider.modelCount > 0
                  ? provider.modelCount
                  : null;
              const canMove =
                typeof props.onMoveProvider === "function" &&
                props.connectedProviders.length > 1 &&
                !actionsDisabled;
              const canMoveUp = canMove && providerIndex > 0;
              const canMoveDown =
                canMove && providerIndex < props.connectedProviders.length - 1;

              return (
                <SettingsBlockRow
                  key={provider.id}
                  title={
                    <span className="inline-flex min-w-0 items-center gap-2.5">
                      <ProviderIcon
                        providerId={provider.id}
                        size={16}
                        className="shrink-0 text-dls-text"
                      />
                      <span className="truncate">{provider.name}</span>
                      {isCloud ? (
                        <StatusBadge size="tiny" tone="accent">
                          {t("settings.provider_badge_cloud")}
                        </StatusBadge>
                      ) : null}
                      {provider.id === "opencode" ? (
                        <StatusBadge size="tiny" tone="success">
                          {t("model_picker.free")}
                        </StatusBadge>
                      ) : null}
                      {/* Built-in Zen (id=opencode): only "free". User custom
                          shows 自定义 — never the OpenCode engine badge. */}
                      {provider.id === "opencode" ? null : provider.source ===
                        "custom" ? (
                        sourceLabel ? (
                          <StatusBadge size="tiny" tone="neutral">
                            {sourceLabel}
                          </StatusBadge>
                        ) : null
                      ) : provider.managedBy === "opencode" ? (
                        <StatusBadge size="tiny" tone="neutral">
                          OpenCode
                        </StatusBadge>
                      ) : sourceLabel ? (
                        <StatusBadge size="tiny" tone="neutral">
                          {sourceLabel}
                        </StatusBadge>
                      ) : null}
                    </span>
                  }
                  description={
                    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-mono text-dls-secondary">
                        {provider.id}
                      </span>
                      {modelCount !== null ? (
                        <span className="text-dls-secondary">
                          {t("settings.provider_model_count", {
                            count: modelCount,
                          })}
                        </span>
                      ) : inventorySyncing ? (
                        <span className="text-dls-secondary/70">
                          {t("settings.provider_model_count_pending")}
                        </span>
                      ) : null}
                    </span>
                  }
                  actions={
                    !isCloud || canMove ? (
                      <div className="inline-flex items-center gap-0.5">
                        {canMove ? (
                          <>
                            <Tooltip>
                              <TooltipTrigger
                                render={(
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-dls-secondary"
                                    disabled={!canMoveUp || props.busy || rowBusy}
                                    onClick={() =>
                                      props.onMoveProvider?.(provider.id, "up")
                                    }
                                    aria-label={t("settings.provider_move_up")}
                                    title={t("settings.provider_reorder_hint")}
                                  >
                                    <ChevronUp aria-hidden="true" className="size-3.5" />
                                  </Button>
                                )}
                              />
                              <TooltipContent>
                                {t("settings.provider_move_up")}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger
                                render={(
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-dls-secondary"
                                    disabled={
                                      !canMoveDown || props.busy || rowBusy
                                    }
                                    onClick={() =>
                                      props.onMoveProvider?.(provider.id, "down")
                                    }
                                    aria-label={t("settings.provider_move_down")}
                                    title={t("settings.provider_reorder_hint")}
                                  >
                                    <ChevronDown
                                      aria-hidden="true"
                                      className="size-3.5"
                                    />
                                  </Button>
                                )}
                              />
                              <TooltipContent>
                                {t("settings.provider_move_down")}
                              </TooltipContent>
                            </Tooltip>
                          </>
                        ) : null}
                        {!isCloud && props.canEditProvider?.(provider) ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={(
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-dls-secondary"
                                  disabled={props.busy || rowBusy}
                                  onClick={() =>
                                    props.onEditProvider?.(provider)
                                  }
                                  aria-label={t(
                                    "agent_manager.provider_modal.edit_provider",
                                  )}
                                >
                                  <Pencil aria-hidden="true" />
                                </Button>
                              )}
                            />
                            <TooltipContent>
                              {t("agent_manager.provider_modal.edit_provider")}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        {!isCloud && props.canDeleteProvider?.(provider) ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={(
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-dls-secondary hover:text-dls-danger"
                                  disabled={props.busy || rowBusy}
                                  onClick={() => setPendingDelete(provider)}
                                  aria-label={t(
                                    "agent_manager.provider_modal.delete_provider",
                                  )}
                                >
                                  <Trash2 aria-hidden="true" />
                                </Button>
                              )}
                            />
                            <TooltipContent>
                              {t(
                                "agent_manager.provider_modal.delete_provider",
                              )}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        {/* Only real disconnectable (e.g. OAuth/API) rows — never a
                            status-looking Unplug on custom/env/OpenCode entries. */}
                        {!isCloud &&
                        !props.canEditProvider?.(provider) &&
                        !props.canDeleteProvider?.(provider) &&
                        props.canDisconnectProvider(provider) ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={(
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-dls-secondary hover:text-dls-danger"
                                  disabled={
                                    props.busy ||
                                    props.providerAuthBusy ||
                                    props.disconnectingProviderId !== null
                                  }
                                  onClick={() =>
                                    void props.onDisconnectProvider(provider.id)
                                  }
                                  aria-label={
                                    props.disconnectingProviderId ===
                                    provider.id
                                      ? t("settings.disconnecting")
                                      : t("settings.disconnect")
                                  }
                                >
                                  <Unplug aria-hidden="true" />
                                </Button>
                              )}
                            />
                            <TooltipContent>
                              {props.disconnectingProviderId === provider.id
                                ? t("settings.disconnecting")
                                : t("settings.disconnect")}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    ) : undefined
                  }
                />
              );
            })
          ) : (
            <div className="flex flex-col gap-3 px-3 py-4">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium text-dls-text">
                  {runtimeConnected
                    ? t("settings.providers_empty_title")
                    : t("settings.providers_empty_runtime_title")}
                </div>
                <p className="text-xs leading-5 text-dls-secondary">
                  {runtimeConnected
                    ? t("settings.providers_empty_body")
                    : t("settings.providers_empty_runtime_body")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void props.onOpenOpencodeConfig?.()}
                  disabled={props.busy}
                >
                  <FileCode className="size-3.5" />
                  {t("settings.providers_empty_cta_custom")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void props.onOpenProviderAuth()}
                  disabled={connectDisabled}
                >
                  {props.providerAuthBusy
                    ? t("system.load_settings_ai")
                    : t("settings.providers_empty_cta_connect")}
                </Button>
              </div>
            </div>
          )}
        </SettingsBlock>

        {/* Only show connect failures when runtime is up; offline is already
            explained by the warning notice / disabled button. */}
        {runtimeConnected && props.providerConnectError ? (
          <SettingsNotice tone="error">
            <span className="flex flex-col gap-2">
              <span>{props.providerConnectError}</span>
              <span className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void props.onOpenProviderAuth()}
                  disabled={connectDisabled}
                >
                  {t("settings.provider_error_retry")}
                </Button>
              </span>
            </span>
          </SettingsNotice>
        ) : null}
        {props.providerDisconnectError ? (
          <SettingsNotice tone="error">
            {props.providerDisconnectError}
          </SettingsNotice>
        ) : null}
      </div>

      {props.cloudProvidersView}

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("settings.provider_delete_confirm_title")}
        message={t("settings.provider_delete_confirm_desc", {
          name: pendingDelete?.name || pendingDelete?.id || "",
        })}
        confirmLabel={t("agent_manager.provider_modal.delete_provider")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) props.onDeleteProvider?.(target);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </LayoutStack>
  );
}
