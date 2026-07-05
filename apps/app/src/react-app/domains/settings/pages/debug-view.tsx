/** @jsxImportSource react */
import {
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  RefreshCcw,
  Smartphone,
} from "lucide-react";

import type {
  OpenworkAuditEntry,
  OpenworkServerCapabilities,
  OpenworkServerDiagnostics,
} from "../../../../app/lib/onmyagent-server";
import type { SandboxDebugProbeResult } from "../../../../app/lib/desktop";
import type {
  OpencodeConnectStatus,
  ReleaseChannel,
  StartupPreference,
} from "../../../../app/types";
import { formatRelativeTime, isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { CodeToken } from "@/components/ui/code-token";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/status-badge";
import { SettingsActionRow, SettingsNotice } from "../settings-section";

const sectionHeaderClass = "flex flex-col gap-1 pb-2";
const sectionTitleClass = "text-base font-medium text-dls-text";
const sectionDescClass = "text-xs text-dls-secondary";
const subSectionTitleClass = "text-sm font-medium leading-5 text-dls-text";
const debugSummaryClass = "cursor-pointer select-none text-sm font-medium text-dls-secondary";
const debugFieldLabelClass = "mb-1 text-xs font-medium text-dls-secondary";
const cardClass =
  "rounded-xl border border-dls-border bg-dls-surface p-5 space-y-4";
const subCardClass = "rounded-xl border border-dls-border bg-dls-sidebar/40 p-4 space-y-3";
const monoPreClass =
  "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-dls-border bg-dls-sidebar/40 p-3 text-xs font-mono text-dls-text";
const miniPreClass =
  "max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-dls-border bg-dls-sidebar/30 p-2 text-xs font-mono text-dls-text";
const electronMigrationBackupName = "OnMyAgent.app.migrate-bak";
const debugStateClass = {
  errorText: "text-dls-status-danger-fg",
  localPreferenceIcon: "bg-dls-status-warning-soft text-dls-status-warning-fg",
  cloudPreferenceIcon: "bg-dls-accent/10 text-dls-accent",
  dangerPanel: "space-y-3 rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft p-5",
  dangerTitle: "text-base font-medium text-dls-status-danger-fg",
  dangerButton: "rounded-xl border-dls-status-danger/40 bg-dls-status-danger text-white hover:bg-dls-status-danger/90 disabled:cursor-not-allowed disabled:opacity-60",
};
const debugLayoutClass = {
  page: "space-y-6 max-w-3xl w-full",
  headerRow: "flex items-start justify-between gap-3",
  actionRow: "flex shrink-0 items-center gap-2",
  wrapActionRow: "flex flex-wrap items-center gap-2",
  metaGrid: "grid gap-2 text-xs text-dls-secondary md:grid-cols-2",
  twoColumnGrid: "grid gap-3 grid-cols-1 lg:grid-cols-2",
  compactStack: "space-y-1",
  dividerStack: "space-y-1 border-t border-dls-mist pt-1",
  mutedText: "text-xs text-dls-secondary",
  monoLine: "truncate text-xs font-mono text-dls-secondary",
  subCardGrid: "grid gap-3 md:grid-cols-2",
  preCompact: "max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs font-mono text-dls-text",
};
type RuntimeSummary = {
  appVersionLabel: string;
  appCommitLabel: string;
  opencodeVersionLabel: string;
  onmyagentServerVersionLabel: string;
};

type StatusPill = {
  label: string;
  tone: StatusBadgeTone;
};

type RuntimeServiceCard = StatusPill & {
  lines: string[];
  stdout?: string | null;
  stderr?: string | null;
  error?: string | null;
};

type OpenCodeConnectDebugCard = StatusPill & {
  lines: string[];
  metricsLines: string[];
  error?: string | null;
};

type ServiceStatus = { tone: "success" | "error"; message: string } | null;

export type DebugViewProps = {
  developerMode: boolean;
  busy: boolean;
  anyActiveRuns: boolean;
  startupPreference: StartupPreference | null;
  startupLabel: string;
  startupStatus: string | null;
  runtimeSummary: RuntimeSummary;
  runtimeDebugReportJson: string;
  runtimeDebugStatus: string | null;
  onCopyRuntimeDebugReport: () => void | Promise<void>;
  onExportRuntimeDebugReport: () => void | Promise<void>;
  developerLogRecordCount: number;
  developerLogText: string;
  developerLogStatus: string | null;
  onClearDeveloperLog: () => void | Promise<void>;
  onCopyDeveloperLog: () => void | Promise<void>;
  onExportDeveloperLog: () => void | Promise<void>;
  electronMigrationAvailable: boolean;
  electronMigrationUrl: string;
  electronMigrationSha256: string;
  electronMigrationSha512: string;
  electronMigrationArtifactLabel: string | null;
  electronMigrationBusy: boolean;
  electronMigrationStatus: string | null;
  electronPreviewReleaseUrl: string;
  onSetElectronMigrationUrl: (value: string) => void;
  onSetElectronMigrationSha256: (value: string) => void;
  onSetElectronMigrationSha512: (value: string) => void;
  onOpenElectronPreviewRelease: () => void | Promise<void>;
  onResolveElectronAlphaArtifact: () => void | Promise<void>;
  onRevealElectronMigrationBackup: () => void | Promise<void>;
  onPrepareElectronMigrationSnapshot: () => void | Promise<void>;
  onInstallElectronPreviewFromLegacy: () => void | Promise<void>;
  electronAlphaUpdaterAvailable: boolean;
  electronAlphaUpdaterBusy: boolean;
  electronAlphaUpdaterStatus: string | null;
  electronAlphaUpdaterChannel: ReleaseChannel;
  onSetElectronAlphaUpdaterChannel: (channel: ReleaseChannel) => void | Promise<void>;
  onCheckElectronAlphaUpdates: () => void | Promise<void>;
  sandboxProbeBusy: boolean;
  sandboxProbeResult: SandboxDebugProbeResult | null;
  sandboxProbeStatus: string | null;
  onRunSandboxDebugProbe: () => void | Promise<void>;
  onStopHost: () => void | Promise<void>;
  onResetStartupPreference: () => void | Promise<void>;
  engineSource: "path" | "sidecar" | "custom";
  onSetEngineSource: (value: "path" | "sidecar" | "custom") => void;
  engineCustomBinPath: string;
  engineCustomBinPathLabel: string;
  onPickEngineBinary: () => void | Promise<void>;
  onClearEngineCustomBinPath: () => void;
  onOpenResetModal: (mode: "onboarding" | "all") => void;
  resetModalBusy: boolean;
  resetStatus: string | null;
  opencodeRestarting: boolean;
  onmyagentServerRestarting: boolean;
  opencodeServiceStatus: ServiceStatus;
  onmyagentServiceStatus: ServiceStatus;
  opencodeLogStatus: string | null;
  onmyagentLogStatus: string | null;
  onCopyOpencodeLogs: () => void | Promise<void>;
  onExportOpencodeLogs: () => void | Promise<void>;
  onCopyOpenworkLogs: () => void | Promise<void>;
  onExportOpenworkLogs: () => void | Promise<void>;
  serviceRestartError: string | null;
  onRestartOpencode: () => void | Promise<void>;
  onRestartOpenworkServer: () => void | Promise<void>;
  engineCard: RuntimeServiceCard;
  opencodeConnectCard: OpenCodeConnectDebugCard;
  onmyagentCard: RuntimeServiceCard;
  onmyagentServerDiagnostics: OpenworkServerDiagnostics | null;
  runtimeWorkspaceId: string | null;
  onmyagentServerCapabilities: OpenworkServerCapabilities | null;
  pendingPermissions: unknown;
  events: unknown;
  workspaceDebugEvents: unknown;
  workspaceDebugEventsStatus: string | null;
  safeStringify: (value: unknown) => string;
  onClearWorkspaceDebugEvents: () => void | Promise<void>;
  onmyagentAuditEntries: OpenworkAuditEntry[];
  onmyagentAuditStatus: StatusPill;
  onmyagentAuditError: string | null;
  opencodeConnectStatus: OpencodeConnectStatus | null;
  opencodeDevModeEnabled: boolean;
  nukeConfigBusy: boolean;
  nukeConfigStatus: string | null;
  onNukeOpenworkAndOpencodeConfig: () => void | Promise<void>;
};

function formatActor(entry: OpenworkAuditEntry) {
  if (entry.actor.type === "host") return t("settings.audit_actor_host");
  if (entry.actor.clientId) return entry.actor.clientId;
  if (entry.actor.tokenHash) return entry.actor.tokenHash;
  return t("settings.audit_actor_remote");
}

function formatCapability(value: { read: boolean; write: boolean }) {
  if (value.read && value.write) return t("settings.cap_read_write");
  if (value.read) return t("settings.cap_read_only");
  if (value.write) return t("settings.cap_write_only");
  return t("settings.disabled");
}

function formatUptime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function DebugLines(props: { lines: string[] }) {
  let offset = 0;
  return props.lines.map((line) => (
    (() => {
      const key = `${offset}:${line}`;
      offset += line.length + 1;
      return (
        <div key={key} className={debugLayoutClass.monoLine}>
          {line}
        </div>
      );
    })()
  ));
}

function StatusBanner(props: { tone: "success" | "error" | "info"; message: string }) {
  const tone = props.tone === "error" ? "error" : props.tone === "success" ? "info" : "neutral";
  return <SettingsNotice tone={tone}>{props.message}</SettingsNotice>;
}

type ServiceCardProps = {
  title: string;
  description: string;
  pill: StatusPill;
  lines: string[];
  stdout?: string | null;
  stderr?: string | null;
  error?: string | null;
  restarting: boolean;
  restartLabel: string;
  onRestart: () => void | Promise<void>;
  serviceStatus: ServiceStatus;
  logStatus: string | null;
  onCopyLogs: () => void | Promise<void>;
  onExportLogs: () => void | Promise<void>;
  isDesktop: boolean;
};

function ServiceCard(props: ServiceCardProps) {
  const restartDisabled = props.restarting || !props.isDesktop;
  return (
    <div className={subCardClass}>
      <div className={debugLayoutClass.headerRow}>
        <div className="min-w-0">
          <div className={subSectionTitleClass}>{props.title}</div>
          <div className={debugLayoutClass.mutedText}>{props.description}</div>
        </div>
        <StatusBadge size="default" tone={props.pill.tone}>
          {props.pill.label}
        </StatusBadge>
      </div>

      <div className={debugLayoutClass.compactStack}><DebugLines lines={props.lines} /></div>

      <div className={debugLayoutClass.wrapActionRow}>
        <Button
          onClick={() => void props.onRestart()}
          disabled={restartDisabled}
          size="sm"
          title={!props.isDesktop ? t("settings.sandbox_requires_desktop") : ""}
        >
          <RefreshCcw className={`mr-1.5 h-3.5 w-3.5 ${props.restarting ? "animate-spin" : ""}`} />
          {props.restarting ? t("settings.restarting") : props.restartLabel}
        </Button>
        <Button
          variant="outline"
          onClick={() => void props.onCopyLogs()}
          size="sm"
        >
          <Copy size={12} className="mr-1.5" />
          {t("settings.copy_logs")}
        </Button>
        <Button
          variant="outline"
          onClick={() => void props.onExportLogs()}
          size="sm"
        >
          <Download size={12} className="mr-1.5" />
          {t("settings.export_log_button")}
        </Button>
      </div>

      {props.serviceStatus ? (
        <StatusBanner tone={props.serviceStatus.tone} message={props.serviceStatus.message} />
      ) : null}
      {props.logStatus ? <StatusBanner tone="info" message={props.logStatus} /> : null}

      <details className="group">
        <summary className={debugSummaryClass}>
          {t("settings.last_stdout")} / {t("settings.last_stderr")}
        </summary>
        <div className="mt-2 grid gap-2">
          <div>
            <div className={debugFieldLabelClass}>
              {t("settings.last_stdout")}
            </div>
            <pre className={miniPreClass}>{props.stdout || t("settings.no_logs_captured")}</pre>
          </div>
          <div>
            <div className={debugFieldLabelClass}>
              {t("settings.last_stderr")}
            </div>
            <pre className={miniPreClass}>{props.stderr || t("settings.no_logs_captured")}</pre>
          </div>
          {props.error ? (
            <div>
              <div className={debugFieldLabelClass}>
                {t("settings.last_error")}
              </div>
              <pre className={miniPreClass}>{props.error}</pre>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

export function DebugView(props: DebugViewProps) {
  if (!props.developerMode) return null;

  const isDesktop = isDesktopRuntime();
  const isLocalPreference = props.startupPreference !== "server";
  const sandboxProbeDisabled = !isDesktop || props.sandboxProbeBusy || props.anyActiveRuns;
  const sandboxProbeTitle = !isDesktop
    ? t("settings.sandbox_requires_desktop")
    : props.anyActiveRuns
      ? t("settings.sandbox_stop_runs_hint")
      : "";

  return (
    <section className={debugLayoutClass.page}>
      {/* Section: Runtime overview */}
      <div className={cardClass}>
        <div className={debugLayoutClass.headerRow}>
          <div>
            <div className={sectionTitleClass}>{t("settings.runtime_debug_title")}</div>
            <div className={sectionDescClass}>{t("settings.runtime_debug_desc")}</div>
          </div>
          <div className={debugLayoutClass.actionRow}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void props.onCopyRuntimeDebugReport()}
            >
              <Copy size={12} className="mr-1.5" />
              {t("settings.copy_json")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void props.onExportRuntimeDebugReport()}
            >
              <Download size={12} className="mr-1.5" />
              {t("settings.export")}
            </Button>
          </div>
        </div>
        <div className={debugLayoutClass.metaGrid}>
          <div>{t("settings.debug_desktop_app", { version: props.runtimeSummary.appVersionLabel })}</div>
          <div>{t("settings.debug_commit", { commit: props.runtimeSummary.appCommitLabel })}</div>
          <div>
            {t("settings.debug_opencode_version", { version: props.runtimeSummary.opencodeVersionLabel })}
          </div>
          <div>
            {t("settings.debug_onmyagent_server_version", {
              version: props.runtimeSummary.onmyagentServerVersionLabel,
            })}
          </div>
        </div>
        {props.runtimeDebugStatus ? <StatusBanner tone="info" message={props.runtimeDebugStatus} /> : null}
        <details className="group">
          <summary className={debugSummaryClass}>
            JSON
          </summary>
          <pre className={`${monoPreClass} mt-2`}>{props.runtimeDebugReportJson}</pre>
        </details>
      </div>

      {/* Section: Services */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.services_section_title")}</div>
          <div className={sectionDescClass}>{t("settings.services_section_desc")}</div>
        </div>

        <div className={debugLayoutClass.twoColumnGrid}>
          <ServiceCard
            title={t("settings.onmyagent_server_label")}
            description={t("settings.onmyagent_config_sidecar_desc")}
            pill={props.onmyagentCard}
            lines={props.onmyagentCard.lines}
            stdout={props.onmyagentCard.stdout ?? null}
            stderr={props.onmyagentCard.stderr ?? null}
            error={props.onmyagentCard.error ?? null}
            restarting={props.onmyagentServerRestarting}
            restartLabel={t("settings.restart_onmyagent_server")}
            onRestart={props.onRestartOpenworkServer}
            serviceStatus={props.onmyagentServiceStatus}
            logStatus={props.onmyagentLogStatus}
            onCopyLogs={props.onCopyOpenworkLogs}
            onExportLogs={props.onExportOpenworkLogs}
            isDesktop={isDesktop}
          />

          <ServiceCard
            title={t("settings.opencode_engine_sidecar")}
            description={t("settings.opencode_engine_sidecar_desc")}
            pill={props.engineCard}
            lines={props.engineCard.lines}
            stdout={props.engineCard.stdout ?? null}
            stderr={props.engineCard.stderr ?? null}
            error={props.engineCard.error ?? null}
            restarting={props.opencodeRestarting}
            restartLabel={t("settings.restart_opencode")}
            onRestart={props.onRestartOpencode}
            serviceStatus={props.opencodeServiceStatus}
            logStatus={props.opencodeLogStatus}
            onCopyLogs={props.onCopyOpencodeLogs}
            onExportLogs={props.onExportOpencodeLogs}
            isDesktop={isDesktop}
          />
        </div>

        <div className={subCardClass}>
          <div className={debugLayoutClass.headerRow}>
            <div className="min-w-0">
              <div className={subSectionTitleClass}>
                {t("settings.opencode_sdk_title")}
              </div>
              <div className={debugLayoutClass.mutedText}>{t("settings.opencode_sdk_desc")}</div>
            </div>
            <StatusBadge size="default" tone={props.opencodeConnectCard.tone}>
              {props.opencodeConnectCard.label}
            </StatusBadge>
          </div>
          <div className={debugLayoutClass.compactStack}><DebugLines lines={props.opencodeConnectCard.lines} /></div>
          {props.opencodeConnectCard.metricsLines.length > 0 ? (
            <div className={debugLayoutClass.dividerStack}>
              <DebugLines lines={props.opencodeConnectCard.metricsLines} />
            </div>
          ) : null}
          {props.opencodeConnectCard.error ? (
            <div>
              <div className={debugFieldLabelClass}>
                {t("settings.last_error")}
              </div>
              <pre className={miniPreClass}>{props.opencodeConnectCard.error}</pre>
            </div>
          ) : null}
        </div>

        {props.serviceRestartError ? (
          <StatusBanner tone="error" message={props.serviceRestartError} />
        ) : null}
      </div>

      {/* Section: Diagnostics */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.onmyagent_diagnostics_title")}</div>
          <div className={sectionDescClass}>
            <span className="font-mono text-xs text-dls-secondary">
              {props.onmyagentServerDiagnostics?.version ?? "—"}
            </span>
          </div>
        </div>

        {props.onmyagentServerDiagnostics ? (
          <div className={debugLayoutClass.metaGrid}>
            <div>{t("settings.diag_started", { time: formatUptime(props.onmyagentServerDiagnostics.uptimeMs) })}</div>
            <div>
              {t("settings.diag_read_only", {
                value: props.onmyagentServerDiagnostics.readOnly ? "true" : "false",
              })}
            </div>
            <div>
              {t("settings.diag_approval", {
                mode: props.onmyagentServerDiagnostics.approval.mode,
                ms: String(props.onmyagentServerDiagnostics.approval.timeoutMs),
              })}
            </div>
            <div>{t("settings.diag_workspaces", { count: String(props.onmyagentServerDiagnostics.workspaceCount) })}</div>
            <div>
              {t("settings.diag_selected_workspace", {
                id: props.onmyagentServerDiagnostics.selectedWorkspaceId ?? "—",
              })}
            </div>
            <div>
              {t("settings.diag_runtime_workspace", {
                id: props.onmyagentServerDiagnostics.activeWorkspaceId ?? "—",
              })}
            </div>
            <div>
              {t("settings.diag_config_path", {
                path: props.onmyagentServerDiagnostics.server.configPath ?? t("settings.diag_default"),
              })}
            </div>
            <div>
              {t("settings.diag_token_source", {
                source: props.onmyagentServerDiagnostics.tokenSource.client,
              })}
            </div>
            <div>
              {t("settings.diag_host_token_source", {
                source: props.onmyagentServerDiagnostics.tokenSource.host,
              })}
            </div>
          </div>
        ) : (
          <div className={debugLayoutClass.mutedText}>{t("settings.diagnostics_unavailable")}</div>
        )}

        <div className={subCardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className={subSectionTitleClass}>
              {t("settings.capabilities_title")}
            </div>
            <div className={debugLayoutClass.monoLine}>
              {props.runtimeWorkspaceId
                ? t("settings.worker_id_label", { id: props.runtimeWorkspaceId })
                : t("settings.worker_unresolved")}
            </div>
          </div>
          {props.onmyagentServerCapabilities ? (
            <div className={debugLayoutClass.metaGrid}>
              <div>{t("settings.cap_skills", { value: formatCapability(props.onmyagentServerCapabilities.skills) })}</div>
              <div>{t("settings.cap_plugins", { value: formatCapability(props.onmyagentServerCapabilities.plugins) })}</div>
              <div>{t("settings.cap_mcp", { value: formatCapability(props.onmyagentServerCapabilities.mcp) })}</div>
              <div>{t("settings.cap_commands", { value: formatCapability(props.onmyagentServerCapabilities.commands) })}</div>
              <div>{t("settings.cap_config", { value: formatCapability(props.onmyagentServerCapabilities.config) })}</div>
              <div>
                {t("settings.cap_browser_tools", {
                  value: (() => {
                    const browser = props.onmyagentServerCapabilities.toolProviders?.browser;
                    if (!browser?.enabled) return t("settings.disabled");
                    return `${browser.mode} · ${browser.placement}`;
                  })(),
                })}
              </div>
              <div>
                {t("settings.cap_file_tools", {
                  value: (() => {
                    const files = props.onmyagentServerCapabilities.toolProviders?.files;
                    if (!files) return t("config.unavailable");
                    return [
                      files.injection ? t("settings.cap_inbox_on") : t("settings.cap_inbox_off"),
                      files.outbox ? t("settings.cap_outbox_on") : t("settings.cap_outbox_off"),
                    ].join(" · ");
                  })(),
                })}
              </div>
              <div>
                {t("settings.cap_sandbox", {
                  value: props.onmyagentServerCapabilities.sandbox
                    ? `${props.onmyagentServerCapabilities.sandbox.backend} (${props.onmyagentServerCapabilities.sandbox.enabled ? t("settings.on") : t("settings.off")})`
                    : t("config.unavailable"),
                })}
              </div>
            </div>
          ) : (
            <div className={debugLayoutClass.mutedText}>{t("settings.capabilities_unavailable")}</div>
          )}
        </div>
      </div>

      {/* Section: Activity */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.activity_section_title")}</div>
          <div className={sectionDescClass}>{t("settings.activity_section_desc")}</div>
        </div>

        <div className={subCardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className={subSectionTitleClass}>
              {t("settings.audit_log_title")}
            </div>
            <StatusBadge size="default" tone={props.onmyagentAuditStatus.tone}>
              {props.onmyagentAuditStatus.label}
            </StatusBadge>
          </div>
          {props.onmyagentAuditError ? <StatusBanner tone="error" message={props.onmyagentAuditError} /> : null}
          {props.onmyagentAuditEntries.length > 0 ? (
            <div className="divide-y divide-dls-border/60">
              {props.onmyagentAuditEntries.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-dls-text">{entry.summary}</div>
                    <div className="truncate text-xs text-dls-secondary">
                      {entry.action} · {entry.target} · {formatActor(entry)}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-xs text-dls-secondary">
                    {entry.timestamp ? formatRelativeTime(entry.timestamp) : "—"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={debugLayoutClass.mutedText}>{t("settings.no_audit_entries")}</div>
          )}
        </div>

        <div className={debugLayoutClass.subCardGrid}>
          <div className={subCardClass}>
            <div className={debugFieldLabelClass}>
              {t("settings.pending_permissions")}
            </div>
            <pre className={debugLayoutClass.preCompact}>
              {props.safeStringify(props.pendingPermissions)}
            </pre>
          </div>
          <div className={subCardClass}>
            <div className={debugFieldLabelClass}>
              {t("settings.recent_events")}
            </div>
            <pre className={debugLayoutClass.preCompact}>
              {props.safeStringify(props.events)}
            </pre>
          </div>
        </div>

        <div className={subCardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className={debugFieldLabelClass}>
              {t("settings.workspace_debug_events_label")}
            </div>
            <Button
              variant="outline"
              size="xs"
              className="shrink-0"
              onClick={() => void props.onClearWorkspaceDebugEvents()}
              disabled={props.busy}
            >
              {t("settings.clear_button")}
            </Button>
          </div>
          <pre className={debugLayoutClass.preCompact}>
            {props.safeStringify(props.workspaceDebugEvents)}
          </pre>
          {props.workspaceDebugEventsStatus ? (
            <StatusBanner tone="info" message={props.workspaceDebugEventsStatus} />
          ) : null}
        </div>
      </div>

      {/* Section: Developer log stream */}
      <div className={cardClass}>
        <div className={debugLayoutClass.headerRow}>
          <div>
            <div className={sectionTitleClass}>{t("settings.developer_log_title")}</div>
            <div className={sectionDescClass}>{t("settings.developer_log_desc")}</div>
          </div>
          <div className={debugLayoutClass.actionRow}>
            <Button variant="outline" size="sm" onClick={() => void props.onClearDeveloperLog()}>
              {t("settings.clear_button")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void props.onCopyDeveloperLog()}>
              <Copy size={12} className="mr-1.5" />
              {t("settings.copy_log_button")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void props.onExportDeveloperLog()}>
              <Download size={12} className="mr-1.5" />
              {t("settings.export_log_button")}
            </Button>
          </div>
        </div>
        <div className={debugLayoutClass.mutedText}>
          {t("settings.developer_log_count", { count: String(props.developerLogRecordCount) })}
        </div>
        <pre className={monoPreClass}>{props.developerLogText || t("settings.developer_log_empty")}</pre>
        {props.developerLogStatus ? <StatusBanner tone="info" message={props.developerLogStatus} /> : null}
      </div>

      {/* Section: Tools */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.tools_section_title")}</div>
          <div className={sectionDescClass}>{t("settings.tools_section_desc")}</div>
        </div>

        <div className={subCardClass}>
          <div className={debugLayoutClass.headerRow}>
            <div>
              <div className={subSectionTitleClass}>
                {t("settings.sandbox_probe_title")}
              </div>
              <div className={debugLayoutClass.mutedText}>{t("settings.sandbox_probe_desc")}</div>
            </div>
            <Button
              size="sm"
              onClick={() => void props.onRunSandboxDebugProbe()}
              disabled={sandboxProbeDisabled}
              title={sandboxProbeTitle}
            >
              {props.sandboxProbeBusy ? t("settings.running_probe") : t("settings.run_sandbox_probe")}
            </Button>
          </div>
          {props.sandboxProbeResult ? (
            <div className="space-y-1 text-xs text-dls-secondary">
              <div>{t("settings.sandbox_run_id", { id: props.sandboxProbeResult.runId ?? "—" })}</div>
              <div>
                {t("settings.sandbox_result", {
                  status: props.sandboxProbeResult.ready ? t("settings.sandbox_ready") : t("settings.sandbox_error"),
                })}
              </div>
              {props.sandboxProbeResult.error ? (
                <div className={debugStateClass.errorText}>{props.sandboxProbeResult.error}</div>
              ) : null}
            </div>
          ) : null}
          {props.sandboxProbeStatus ? <StatusBanner tone="info" message={props.sandboxProbeStatus} /> : null}
          <div className={debugLayoutClass.mutedText}>{t("settings.sandbox_export_hint")}</div>
        </div>

        {isDesktop && (isLocalPreference || props.developerMode) ? (
          <div className={subCardClass}>
            <div>
              <div className={subSectionTitleClass}>{t("settings.engine_title")}</div>
              <div className={debugLayoutClass.mutedText}>{t("settings.engine_desc")}</div>
            </div>

            {!isLocalPreference ? (
              <StatusBanner tone="info" message={t("settings.startup_remote_warning")} />
            ) : null}

            <div className="space-y-3">
              <div className={debugLayoutClass.mutedText}>{t("settings.engine_source_debug")}</div>
              <div className={props.developerMode ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
                <Button
                  variant={props.engineSource === "sidecar" ? "secondary" : "outline"}
                  onClick={() => props.onSetEngineSource("sidecar")}
                  disabled={props.busy}
                >
                  {t("settings.engine_bundled")}
                </Button>
                <Button
                  variant={props.engineSource === "path" ? "secondary" : "outline"}
                  onClick={() => props.onSetEngineSource("path")}
                  disabled={props.busy}
                >
                  {t("settings.engine_system_path")}
                </Button>
                {props.developerMode ? (
                  <Button
                    variant={props.engineSource === "custom" ? "secondary" : "outline"}
                    onClick={() => props.onSetEngineSource("custom")}
                    disabled={props.busy}
                  >
                    {t("settings.engine_custom_binary")}
                  </Button>
                ) : null}
              </div>
              <div className={debugLayoutClass.mutedText}>{t("settings.engine_bundled_hint")}</div>
            </div>

            {props.developerMode && props.engineSource === "custom" ? (
              <div className="space-y-2">
                <div className={debugLayoutClass.mutedText}>{t("settings.custom_binary_label")}</div>
                <div className="flex items-center gap-2">
                  <div
                    className="min-w-0 flex-1 truncate rounded-xl border border-dls-border bg-dls-surface p-3 font-mono text-xs text-dls-secondary"
                    title={props.engineCustomBinPathLabel}
                  >
                    {props.engineCustomBinPathLabel}
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void props.onPickEngineBinary()}
                    disabled={props.busy}
                  >
                    {t("settings.choose")}
                  </Button>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={props.onClearEngineCustomBinPath}
                    disabled={props.busy || !props.engineCustomBinPath.trim()}
                    title={!props.engineCustomBinPath.trim() ? t("settings.no_custom_path_set") : t("settings.clear")}
                  >
                    {t("settings.clear")}
                  </Button>
                </div>
                <div className={debugLayoutClass.mutedText}>{t("settings.custom_binary_hint")}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={subCardClass}>
          <div className={subSectionTitleClass}>
            {t("settings.startup_title")}
          </div>

          <SettingsActionRow>
            <div className="flex items-center gap-3">
              <div
                className={`rounded-lg p-2 ${
                  isLocalPreference ? debugStateClass.localPreferenceIcon : debugStateClass.cloudPreferenceIcon
                }`}
              >
                {isLocalPreference ? <HardDrive size={16} /> : <Smartphone size={16} />}
              </div>
              <span className="text-sm font-medium text-dls-text">{props.startupLabel}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void props.onStopHost()}
              disabled={props.busy}
            >
              {t("settings.switch")}
            </Button>
          </SettingsActionRow>

          <Button
            variant="outline"
            className="group w-full justify-between"
            onClick={() => void props.onResetStartupPreference()}
          >
            <span>{t("settings.reset_startup_pref")}</span>
            <RefreshCcw size={14} className="opacity-80 transition-transform group-hover:rotate-180" />
          </Button>

          <p className="text-xs text-dls-secondary">{t("settings.startup_reset_hint")}</p>
          {props.startupStatus ? <StatusBanner tone="info" message={props.startupStatus} /> : null}
        </div>
      </div>

      {/* Section: Reset & recovery */}
      <div className={cardClass}>
        <div className={sectionHeaderClass}>
          <div className={sectionTitleClass}>{t("settings.recovery_section_title")}</div>
          <div className={sectionDescClass}>{t("settings.recovery_section_desc")}</div>
        </div>

        <SettingsActionRow>
          <div className="min-w-0">
            <div className="text-sm text-dls-text">{t("settings.reset_onboarding_title")}</div>
            <div className="text-xs text-dls-secondary">{t("settings.reset_onboarding_description")}</div>
          </div>
          <Button
            variant="outline"
            size="sm" className="shrink-0"
            onClick={() => props.onOpenResetModal("onboarding")}
            disabled={props.busy || props.resetModalBusy || props.anyActiveRuns}
            title={props.anyActiveRuns ? t("settings.stop_runs_to_reset") : ""}
          >
            {t("settings.reset_button")}
          </Button>
        </SettingsActionRow>

        <SettingsActionRow>
          <div className="min-w-0">
            <div className="text-sm text-dls-text">{t("settings.reset_app_data_title")}</div>
            <div className="text-xs text-dls-secondary">{t("settings.reset_app_data_description")}</div>
          </div>
          <Button
            variant="destructive"
            size="sm" className="shrink-0"
            onClick={() => props.onOpenResetModal("all")}
            disabled={props.busy || props.resetModalBusy || props.anyActiveRuns}
            title={props.anyActiveRuns ? t("settings.stop_runs_to_reset") : ""}
          >
            {t("settings.reset_button")}
          </Button>
        </SettingsActionRow>

        <div className="text-xs text-dls-secondary">{t("settings.reset_requires_confirm")}</div>
        {props.resetStatus ? <StatusBanner tone="info" message={props.resetStatus} /> : null}
      </div>

      {/* Section: Electron alpha migration (debug only) */}
      {props.electronMigrationAvailable ? (
        <div className={cardClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={sectionTitleClass}>Electron alpha migration</div>
              <div className={sectionDescClass}>
                Debug-only migration controls. Preparing migration data is non-destructive; installing requires a URL and two
                confirmations.
              </div>
            </div>
            <Button
              variant="outline"
              size="sm" className="shrink-0"
              onClick={() => void props.onOpenElectronPreviewRelease()}
            >
              <ExternalLink size={12} className="mr-1.5" />
              Alpha release
            </Button>
          </div>

          <SettingsNotice tone="info" className="leading-relaxed">
            {t("settings.debug.electron_migration_safe_default_prefix")} <strong>{t("settings.debug.electron_migration_prepare")}</strong>{" "}
            {t("settings.debug.electron_migration_safe_default_suffix")} {" "}
            <CodeToken tone="muted">{electronMigrationBackupName}</CodeToken>.
          </SettingsNotice>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void props.onResolveElectronAlphaArtifact()}
              disabled={props.electronMigrationBusy}
            >
              {props.electronMigrationBusy ? t("settings.debug.electron_migration_resolving") : t("settings.debug.electron_migration_resolve_latest")}
            </Button>
            {props.electronMigrationArtifactLabel ? (
              <div className="min-w-0 flex-1 truncate text-xs text-dls-secondary">
                {props.electronMigrationArtifactLabel}
              </div>
            ) : (
              <div className="text-xs text-dls-secondary">{t("settings.debug.electron_migration_uses_latest")}</div>
            )}
          </div>

          <details className="rounded-xl border border-dls-border bg-dls-sidebar/30 p-3">
            <summary className={debugSummaryClass}>
              {t("settings.debug.electron_migration_manual_override")}
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <label className="space-y-1 text-xs text-dls-secondary">
                <span>{t("settings.debug.electron_migration_artifact_url")}</span>
                <Input
                  type="url"
                  value={props.electronMigrationUrl}
                  onChange={(event) => props.onSetElectronMigrationUrl(event.currentTarget.value)}
                  placeholder={t("settings.debug.electron_migration_artifact_url_placeholder")}
                  variant="dlsMono"
                  controlSize="lg"
                />
              </label>
              <label className="space-y-1 text-xs text-dls-secondary">
                <span>sha512 from latest-mac.yml</span>
                <Input
                  type="text"
                  value={props.electronMigrationSha512}
                  onChange={(event) => props.onSetElectronMigrationSha512(event.currentTarget.value)}
                  placeholder="recommended"
                  variant="dlsMono"
                  controlSize="lg"
                />
              </label>
              <label className="space-y-1 text-xs text-dls-secondary md:col-span-2">
                <span>sha256 override (legacy optional)</span>
                <Input
                  type="text"
                  value={props.electronMigrationSha256}
                  onChange={(event) => props.onSetElectronMigrationSha256(event.currentTarget.value)}
                  placeholder={t("settings.debug.electron_migration_sha256_placeholder")}
                  variant="dlsMono"
                  controlSize="lg"
                />
              </label>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void props.onPrepareElectronMigrationSnapshot()}
              disabled={props.electronMigrationBusy}
            >
              {props.electronMigrationBusy ? t("settings.debug.electron_migration_preparing") : t("settings.debug.electron_migration_prepare")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void props.onInstallElectronPreviewFromLegacy()}
              disabled={props.electronMigrationBusy || !props.electronMigrationUrl.trim()}
              title={t("settings.debug.electron_migration_install_hint")}
            >
              {t("settings.debug.electron_migration_start_install")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void props.onRevealElectronMigrationBackup()}
              disabled={props.electronMigrationBusy}
            >
              {t("settings.debug.electron_migration_open_backup")}
            </Button>
            <div className="text-xs text-dls-secondary">
              Release page: <span className="font-mono">{props.electronPreviewReleaseUrl}</span>
            </div>
          </div>

          {props.electronMigrationStatus ? (
            <StatusBanner tone="info" message={props.electronMigrationStatus} />
          ) : null}
        </div>
      ) : null}

      {/* Section: Electron alpha updater (debug only) */}
      {props.electronAlphaUpdaterAvailable ? (
        <div className={cardClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={sectionTitleClass}>Electron alpha channel</div>
              <div className={sectionDescClass}>
                Debug-only controls for migrated Electron users. Stable updates remain the default in Settings → Updates.
              </div>
            </div>
            <StatusBadge tone="surface" size="default">
              {props.electronAlphaUpdaterChannel === "alpha" ? "Alpha" : "Stable"}
            </StatusBadge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={props.electronAlphaUpdaterChannel === "alpha" ? "secondary" : "outline"}
              size="sm"
              onClick={() => void props.onSetElectronAlphaUpdaterChannel("alpha")}
              disabled={props.electronAlphaUpdaterBusy}
            >
              Use alpha feed
            </Button>
            <Button
              variant={props.electronAlphaUpdaterChannel === "stable" ? "secondary" : "outline"}
              size="sm"
              onClick={() => void props.onSetElectronAlphaUpdaterChannel("stable")}
              disabled={props.electronAlphaUpdaterBusy}
            >
              Return to stable
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void props.onCheckElectronAlphaUpdates()}
              disabled={props.electronAlphaUpdaterBusy}
            >
              {props.electronAlphaUpdaterBusy ? "Checking…" : "Check selected feed"}
            </Button>
          </div>

          <div className="text-xs text-dls-secondary">
            Alpha feed: <span className="font-mono">alpha-macos-latest/latest-mac.yml</span>. Stable feed:{" "}
            <span className="font-mono">releases/latest/download/latest-mac.yml</span>.
          </div>

          {props.electronAlphaUpdaterStatus ? (
            <StatusBanner tone="info" message={props.electronAlphaUpdaterStatus} />
          ) : null}
        </div>
      ) : null}

      {/* Section: Danger zone */}
      {isDesktop ? (
        <div className={debugStateClass.dangerPanel}>
          <div className={sectionHeaderClass}>
            <div className={debugStateClass.dangerTitle}>
              {t("settings.danger_section_title")}
            </div>
            <div className={sectionDescClass}>{t("settings.danger_section_desc")}</div>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={subSectionTitleClass}>
                {t("settings.reset_onmyagent_title")}
              </div>
              <div className="text-xs text-dls-secondary">
                {props.opencodeDevModeEnabled
                  ? t("settings.reset_onmyagent_desc_dev")
                  : t("settings.reset_onmyagent_desc_prod")}
              </div>
            </div>
            <StatusBadge size="default" tone={props.opencodeDevModeEnabled ? "accent" : "neutral"}>
              {props.opencodeDevModeEnabled
                ? t("settings.dev_mode_badge")
                : t("settings.production_mode_badge")}
            </StatusBadge>
          </div>

          <div className="text-xs text-dls-secondary">{t("settings.quit_hint")}</div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="destructive"
              size="default"
              className={debugStateClass.dangerButton}
              onClick={() => void props.onNukeOpenworkAndOpencodeConfig()}
              disabled={props.busy || props.nukeConfigBusy}
            >
              <CircleAlert size={14} />
              {props.nukeConfigBusy
                ? t("settings.removing_local_state")
                : t("settings.delete_local_config")}
            </Button>
            <div className="text-xs text-dls-secondary">{t("settings.nuke_hint")}</div>
          </div>

          {props.nukeConfigStatus ? <StatusBanner tone="error" message={props.nukeConfigStatus} /> : null}
        </div>
      ) : null}
    </section>
  );
}
