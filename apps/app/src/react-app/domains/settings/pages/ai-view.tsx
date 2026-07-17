/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { FileCode } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@/i18n";
import { ProviderIcon } from "../../../design-system/provider-icon";
import {
  SettingsNotice,
  SettingsPageSection,
  SettingsStatusBadge,
} from "../settings-section";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemFootnote,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutStack,
} from "../settings-layout";
import { APP_NAME } from "../../../../i18n/locales/brand";

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
      {/* ---- Providers ---- */}
      <SettingsPageSection
        title={t("settings.providers_title")}
        description={t("settings.providers_desc")}
      >
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>
              {props.providerSummary}
              <SettingsStatusBadge
                tone={providerStatusTone(
                  props.providerStatusLabel,
                  props.providerConnected,
                )}
                label={props.providerStatusLabel}
              />
            </LayoutSectionItemTitle>
            <LayoutSectionItemHeaderActions>
              <Button
                variant="outline"
                onClick={() => void props.onOpenOpencodeConfig?.()}
                disabled={props.busy}
              >
                <FileCode size={14} />
                {t("settings.custom_provider_config")}
              </Button>
              <Button
                onClick={() => void props.onOpenProviderAuth()}
                disabled={props.busy || props.providerAuthBusy}
              >
                {props.providerAuthBusy
                  ? t("settings.loading_providers")
                  : t("settings.connect_provider")}
              </Button>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        {/* {props.showOnMyAgentModelsSubscribe ? (
          <LayoutSectionItem className="flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-dls-accent/30 bg-dls-decision-soft px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <ProviderIcon
                providerId="onmyagent"
                size={20}
                className="text-dls-accent"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-dls-text">
                  {APP_NAME} Models
                </div>
                <div className="text-xs text-muted-foreground">
                  Frontier intelligence, hand picked for your team&apos;s most
                  ambitious work.
                </div>
              </div>
            </div>
            <Button
              onClick={() => void props.onSubscribeOnMyAgentModels?.()}
              disabled={props.busy || props.providerAuthBusy}
            >
              Subscribe
            </Button>
          </LayoutSectionItem>
        ) : null} */}

        {props.connectedProviders.length > 0 ? (
          <div className="space-y-2">
            {props.connectedProviders.map((provider) => (
              <LayoutSectionItem
                key={provider.id}
                className="flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-dls-border px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ProviderIcon
                    providerId={provider.id}
                    size={20}
                    className="text-dls-text"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-dls-text">
                        {provider.name}
                      </span>
                      {props.cloudProviderIds?.has(provider.id) ? (
                        <StatusBadge size="tiny" tone="accent">
                          Cloud
                        </StatusBadge>
                      ) : null}
                      {provider.managedBy === "opencode" ? (
                        <StatusBadge size="tiny" tone="neutral">
                          OpenCode
                        </StatusBadge>
                      ) : providerSourceLabel(provider.source) ? (
                        <StatusBadge size="tiny" tone="neutral">
                          {providerSourceLabel(provider.source)}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {provider.id}
                    </div>
                  </div>
                </div>
                {!props.cloudProviderIds?.has(provider.id) ? (
                  <Button
                    variant={
                      provider.managedBy === "opencode"
                        ? "outline"
                        : "destructive"
                    }
                    onClick={() => void props.onDisconnectProvider(provider.id)}
                    disabled={
                      props.busy ||
                      props.providerAuthBusy ||
                      props.disconnectingProviderId !== null ||
                      !props.canDisconnectProvider(provider)
                    }
                  >
                    {props.disconnectingProviderId === provider.id
                      ? t("settings.disconnecting")
                      : provider.managedBy === "opencode"
                        ? t("settings.managed_by_opencode")
                      : props.canDisconnectProvider(provider)
                        ? t("settings.disconnect")
                        : t("settings.managed_by_env")}
                  </Button>
                ) : null}
              </LayoutSectionItem>
            ))}
          </div>
        ) : null}

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

        <LayoutSectionItemFootnote>
          {t("settings.api_keys_info")}
        </LayoutSectionItemFootnote>
      </SettingsPageSection>

      {props.cloudProvidersView}
    </LayoutStack>
  );
}
