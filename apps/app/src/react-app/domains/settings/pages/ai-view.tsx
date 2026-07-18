/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { FileCode, MoreHorizontal, Pencil, Trash2, Unplug } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@/i18n";
import { ProviderIcon } from "../../../design-system/provider-icon";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsNotice,
  SettingsStatusBadge,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";

export type AiSettingsConnectedProvider = {
  id: string;
  name: string;
  source?: "env" | "api" | "config" | "custom";
  managedBy?: "opencode";
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
  return "neutral";
}

export function AiSettingsView(props: AiSettingsViewProps) {
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
              <FileCode className="size-3.5" />
              {t("settings.custom_provider_config")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void props.onOpenProviderAuth()}
              disabled={props.busy || props.providerAuthBusy}
            >
              {props.providerAuthBusy
                ? t("settings.loading_providers")
                : t("settings.connect_provider")}
            </Button>
          </div>
        </div>

        <SettingsBlock>
          {props.connectedProviders.length > 0 ? (
            props.connectedProviders.map((provider) => {
              const sourceLabel = providerSourceLabel(provider.source);
              const isCloud = props.cloudProviderIds?.has(provider.id) === true;
              const rowBusy = props.providerActionBusyId === provider.id;

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
                          Cloud
                        </StatusBadge>
                      ) : null}
                      {provider.managedBy === "opencode" ? (
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
                    <span className="font-mono text-xs">{provider.id}</span>
                  }
                  actions={
                    !isCloud ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("settings.provider_more_actions")}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-44">
                          {props.canEditProvider?.(provider) ? (
                            <>
                              <DropdownMenuItem
                                disabled={props.busy || rowBusy}
                                onClick={() => props.onEditProvider?.(provider)}
                              >
                                <Pencil />
                                {t("agent_manager.provider_modal.edit_provider")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={
                                  props.busy ||
                                  rowBusy ||
                                  props.canDeleteProvider?.(provider) === false
                                }
                                onClick={() =>
                                  props.onDeleteProvider?.(provider)
                                }
                              >
                                <Trash2 />
                                {t(
                                  "agent_manager.provider_modal.delete_provider",
                                )}
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={
                                props.busy ||
                                props.providerAuthBusy ||
                                props.disconnectingProviderId !== null ||
                                !props.canDisconnectProvider(provider)
                              }
                              onClick={() =>
                                void props.onDisconnectProvider(provider.id)
                              }
                            >
                              <Unplug />
                              {props.disconnectingProviderId === provider.id
                                ? t("settings.disconnecting")
                                : props.canDisconnectProvider(provider)
                                  ? t("settings.disconnect")
                                  : t("settings.managed_by_env")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : undefined
                  }
                />
              );
            })
          ) : (
            <SettingsBlockRow
              title={t("settings.no_providers_connected")}
              description={t("settings.connect_provider_empty_hint")}
            />
          )}
        </SettingsBlock>

        <p className="text-xs leading-5 text-dls-secondary">
          {t("settings.api_keys_info")}
        </p>

        {props.providerConnectError ? (
          <SettingsNotice tone="error">
            {props.providerConnectError}
          </SettingsNotice>
        ) : null}
        {props.providerDisconnectStatus ? (
          <SettingsNotice>{props.providerDisconnectStatus}</SettingsNotice>
        ) : null}
        {props.providerDisconnectError ? (
          <SettingsNotice tone="error">
            {props.providerDisconnectError}
          </SettingsNotice>
        ) : null}
      </div>

      {props.cloudProvidersView}
    </LayoutStack>
  );
}
