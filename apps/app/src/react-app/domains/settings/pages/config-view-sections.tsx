/** @jsxImportSource react */
import { RefreshCcw } from "lucide-react";

import type { OnMyAgentServerInfo } from "../../../../app/lib/desktop";
import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { LabeledInput } from "../../../design-system/labeled-input";
import { SettingsActionRow, SettingsCard, SettingsNotice } from "../settings-section";
import type { OnMyAgentTestState, TokenVisibilityKey } from "./config-view-state";

const configTextClass = {
  sectionTitle: "text-sm font-medium text-dls-text",
  rowTitle: "text-sm text-dls-text",
  description: "text-xs text-dls-secondary",
  label: "text-xs font-medium text-dls-secondary",
  code: "text-xs font-mono text-dls-secondary truncate",
  pre: "text-xs text-dls-text whitespace-pre-wrap break-words max-h-64 overflow-auto bg-dls-surface border border-dls-border rounded-xl p-3",
  status: "text-xs",
};

export function ConfigWorkspaceSummary(props: { runtimeWorkspaceId: string | null }) {
  return (
    <SettingsCard className="space-y-2">
      <div className={configTextClass.sectionTitle}>{t("config.workspace_config_title")}</div>
      <div className={configTextClass.description}>{t("config.workspace_config_desc")}</div>
      {props.runtimeWorkspaceId ? (
        <div className={configTextClass.code}>
          {t("config.workspace_id_prefix")}
          {props.runtimeWorkspaceId}
        </div>
      ) : null}
    </SettingsCard>
  );
}

export function ConfigEngineReloadSection(props: {
  anyActiveRuns: boolean;
  reloadBusy: boolean;
  reloadError: string | null;
  reloadAvailabilityReason: string | null;
  reloadButtonTone: "destructive" | "secondary";
  reloadButtonDisabled: boolean;
  reloadButtonLabel: string;
  onReload: () => Promise<void>;
}) {
  return (
    <SettingsCard className="space-y-4">
      <div>
        <div className={configTextClass.sectionTitle}>{t("config.engine_reload_title")}</div>
        <div className={configTextClass.description}>{t("config.engine_reload_desc")}</div>
      </div>
      <SettingsActionRow>
        <div className="min-w-0 space-y-1">
          <div className={configTextClass.rowTitle}>{t("config.reload_now_title")}</div>
          <div className={configTextClass.description}>{t("config.reload_now_desc")}</div>
          {props.anyActiveRuns ? <SettingsNotice tone="warning">{t("config.reload_active_tasks_warning")}</SettingsNotice> : null}
          {props.reloadError ? <SettingsNotice tone="error">{props.reloadError}</SettingsNotice> : null}
          {props.reloadAvailabilityReason ? <div className={configTextClass.description}>{props.reloadAvailabilityReason}</div> : null}
        </div>
        <Button variant={props.reloadButtonTone} size="sm" onClick={props.onReload} disabled={props.reloadButtonDisabled}>
          <RefreshCcw size={14} className={props.reloadBusy ? "animate-spin" : ""} />
          {props.reloadButtonLabel}
        </Button>
      </SettingsActionRow>
    </SettingsCard>
  );
}

export function ConfigDiagnosticsSection(props: {
  busy: boolean;
  diagnosticsBundleJson: string;
  copyingField: string | null;
  onCopy: (value: string, field: string) => void | Promise<void>;
}) {
  return (
    <SettingsCard className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className={configTextClass.sectionTitle}>{t("config.diagnostics_title")}</div>
          <div className={configTextClass.description}>{t("config.diagnostics_desc")}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void props.onCopy(props.diagnosticsBundleJson, "debug-bundle")} disabled={props.busy}>
          {props.copyingField === "debug-bundle" ? t("config.copied") : t("config.copy")}
        </Button>
      </div>
      <pre className={configTextClass.pre}>
        {props.diagnosticsBundleJson}
      </pre>
    </SettingsCard>
  );
}

function TokenRow(props: {
  label: string;
  tokenValue: string | null | undefined;
  hint: string;
  visible: boolean;
  toggle: () => void;
  copyKey: string;
  copyingField: string | null;
  onCopy: (value: string, field: string) => void | Promise<void>;
}) {
  return (
    <SettingsActionRow>
      <div className="min-w-0">
        <div className={configTextClass.label}>{props.label}</div>
        <div className={configTextClass.code}>
          {props.visible ? props.tokenValue || "—" : props.tokenValue ? "••••••••••••" : "—"}
        </div>
        <div className={`mt-1 ${configTextClass.description}`}>{props.hint}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={props.toggle} disabled={!props.tokenValue}>
          {props.visible ? t("common.hide") : t("common.show")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.onCopy(props.tokenValue ?? "", props.copyKey)} disabled={!props.tokenValue}>
          {props.copyingField === props.copyKey ? t("config.copied") : t("config.copy")}
        </Button>
      </div>
    </SettingsActionRow>
  );
}

export function ConfigServerSharingSection(props: {
  hostInfo: OnMyAgentServerInfo;
  hostConnectUrl: string;
  hostRemoteAccessEnabled: boolean;
  hostConnectUrlUsesMdns: boolean;
  hostStatusLabel: string;
  hostStatusStyle: string;
  tokenVisible: Record<TokenVisibilityKey, boolean>;
  copyingField: string | null;
  onCopy: (value: string, field: string) => void | Promise<void>;
  onToggleToken: (key: TokenVisibilityKey) => void;
}) {
  const hostUrlHint = !props.hostRemoteAccessEnabled
    ? t("config.remote_access_off_hint")
    : props.hostConnectUrlUsesMdns
      ? t("config.mdns_hint")
      : t("config.local_ip_hint");
  return (
    <SettingsCard className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className={configTextClass.sectionTitle}>{t("config.server_sharing_title")}</div>
          <div className={configTextClass.description}>{t("config.server_sharing_desc")}</div>
        </div>
        <div className={`text-xs px-2 py-1 rounded-full border ${props.hostStatusStyle}`}>{props.hostStatusLabel}</div>
      </div>
      <div className="grid gap-3">
        <SettingsActionRow>
          <div className="min-w-0">
            <div className={configTextClass.label}>{t("config.server_url_label")}</div>
            <div className={configTextClass.code}>{props.hostConnectUrl || t("config.starting_server")}</div>
            {props.hostConnectUrl ? <div className={`mt-1 ${configTextClass.description}`}>{hostUrlHint}</div> : null}
          </div>
          <Button variant="outline" size="sm" onClick={() => props.onCopy(props.hostConnectUrl, "host-url")} disabled={!props.hostConnectUrl}>
            {props.copyingField === "host-url" ? t("config.copied") : t("config.copy")}
          </Button>
        </SettingsActionRow>
        <TokenRow label={t("config.collaborator_token_label")} tokenValue={props.hostInfo.clientToken} hint={props.hostRemoteAccessEnabled ? t("config.collaborator_token_remote_hint") : t("config.collaborator_token_disabled_hint")} visible={props.tokenVisible.client} toggle={() => props.onToggleToken("client")} copyKey="client-token" copyingField={props.copyingField} onCopy={props.onCopy} />
        <TokenRow label={t("config.owner_token_label")} tokenValue={props.hostInfo.ownerToken} hint={props.hostRemoteAccessEnabled ? t("config.owner_token_remote_hint") : t("config.owner_token_disabled_hint")} visible={props.tokenVisible.owner} toggle={() => props.onToggleToken("owner")} copyKey="owner-token" copyingField={props.copyingField} onCopy={props.onCopy} />
        <TokenRow label={t("config.host_admin_token_label")} tokenValue={props.hostInfo.hostToken} hint={t("config.host_admin_token_hint")} visible={props.tokenVisible.host} toggle={() => props.onToggleToken("host")} copyKey="host-token" copyingField={props.copyingField} onCopy={props.onCopy} />
      </div>
      <div className={configTextClass.description}>{t("config.server_sharing_menu_hint")}</div>
    </SettingsCard>
  );
}

export function ConfigServerConnectionSection(props: {
  busy: boolean;
  onmyagentUrl: string;
  onmyagentToken: string;
  tokenVisible: boolean;
  onmyagentStatusLabel: string;
  onmyagentStatusTone: StatusBadgeTone;
  resolvedWorkspaceUrl: string;
  resolvedWorkspaceId: string;
  onmyagentTestState: OnMyAgentTestState;
  onmyagentTestMessage: string | null;
  hasOnMyAgentChanges: boolean;
  onUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onToggleToken: () => void;
  onTestConnection: () => Promise<void>;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <SettingsCard className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className={configTextClass.sectionTitle}>{t("config.server_section_title")}</div>
          <div className={configTextClass.description}>{t("config.server_section_desc")}</div>
        </div>
        <StatusBadge tone={props.onmyagentStatusTone}>{props.onmyagentStatusLabel}</StatusBadge>
      </div>
      <div className="grid gap-3">
        <LabeledInput label={t("config.server_url_input_label")} value={props.onmyagentUrl} onChange={(event) => props.onUrlChange(event.currentTarget.value)} placeholder="http://127.0.0.1:<port>" hint={t("config.server_url_hint")} disabled={props.busy} />
        <div>
          <div className="flex items-center gap-2">
            <LabeledInput
              label={t("config.token_label")}
              type={props.tokenVisible ? "text" : "password"}
              value={props.onmyagentToken}
              onChange={(event) => props.onTokenChange(event.currentTarget.value)}
              placeholder={t("config.token_placeholder")}
              disabled={props.busy}
              hint={t("config.token_hint")}
              wrapperClassName="min-w-0 flex-1"
            />
            <Button variant="outline" size="sm" className="mt-5 shrink-0" onClick={props.onToggleToken} disabled={props.busy}>
              {props.tokenVisible ? t("common.hide") : t("common.show")}
            </Button>
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <div className={configTextClass.code}>{t("config.resolved_worker_url")}{props.resolvedWorkspaceUrl || t("config.not_set")}</div>
        <div className={configTextClass.code}>{t("config.worker_id")}{props.resolvedWorkspaceId || t("config.unavailable")}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void props.onTestConnection()} disabled={props.busy || props.onmyagentTestState === "testing"}>{props.onmyagentTestState === "testing" ? t("config.testing") : t("config.test_connection")}</Button>
        <Button onClick={props.onSave} disabled={props.busy || !props.hasOnMyAgentChanges}>{t("common.save")}</Button>
        <Button variant="outline" onClick={props.onReset} disabled={props.busy}>{t("common.reset")}</Button>
      </div>
      {props.onmyagentTestState !== "idle" ? <ConfigConnectionTestStatus state={props.onmyagentTestState} message={props.onmyagentTestMessage} /> : null}
      {props.onmyagentStatusLabel !== t("config.status_connected") ? <div className={configTextClass.description}>{t("config.server_needed_hint")}</div> : null}
    </SettingsCard>
  );
}

function ConfigConnectionTestStatus(props: { state: OnMyAgentTestState; message: string | null }) {
  return (
    <div className={`${configTextClass.status} ${props.state === "success" ? "text-dls-accent" : props.state === "error" ? "text-dls-status-danger-fg" : "text-dls-secondary"}`} role="status" aria-live="polite">
      {props.state === "testing" ? t("config.testing_connection") : (props.message ?? t("config.connection_status_updated"))}
    </div>
  );
}

export function ConfigMessagingIdentitiesSection() {
  return (
    <SettingsCard className="space-y-2">
      <div className={configTextClass.sectionTitle}>{t("config.messaging_identities_title")}</div>
      <div className={configTextClass.description}>{t("config.messaging_identities_desc")}</div>
    </SettingsCard>
  );
}
