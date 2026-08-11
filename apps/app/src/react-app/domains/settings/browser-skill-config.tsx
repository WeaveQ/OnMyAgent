/** @jsxImportSource react */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  Terminal,
} from "lucide-react";

import { desktopBridge } from "../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { busySpinClass } from "@/components/ui/busy-spin";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { registerExtensionConfig } from "../shared";

const FALLBACK_INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/Tencent/BrowserSkill/main/install.sh | sh && bsk doctor";

type BrowserSkillStatus = {
  ok: boolean;
  installed: boolean;
  extensionConnected: boolean;
  version: string | null;
  binaryPath?: string | null;
  message: string;
  doctorSummary?: string | null;
  installCliUrl: string;
  chromeWebStoreUrl: string;
  docsUrl: string;
  installCommand?: string;
};

function hasDesktopBridge() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.__ONMYAGENT_ELECTRON__?.invokeDesktop)
  );
}

/** Broadcast doctor result so plugins cards/dialogs update fullyConnected UI. */
export function emitBrowserSkillStatusChanged(detail: {
  ok: boolean;
  installed?: boolean;
  extensionConnected?: boolean;
}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("onmyagent:browser-skill-status-changed", { detail }),
  );
}

registerExtensionConfig("browser-skill", () => <BrowserSkillConfig />);
registerExtensionConfig("onmyagent.browserSkill.settings", () => (
  <BrowserSkillConfig />
));

export function BrowserSkillConfig() {
  const [status, setStatus] = useState<BrowserSkillStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!hasDesktopBridge()) {
      setStatus(null);
      setError(t("extensions.browser_skill_desktop_only"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = (await desktopBridge.checkBrowserSkillStatus()) as BrowserSkillStatus;
      setStatus(raw);
      emitBrowserSkillStatusChanged({
        ok: raw.ok === true,
        installed: raw.installed === true,
        extensionConnected: raw.extensionConnected === true,
      });
    } catch (cause) {
      setStatus(null);
      setError(
        cause instanceof Error ? cause.message : t("settings.unreadable_response"),
      );
      emitBrowserSkillStatusChanged({
        ok: false,
        installed: false,
        extensionConnected: false,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openTarget = async (target: "cli" | "extension" | "docs") => {
    if (!hasDesktopBridge()) return;
    try {
      const result = (await desktopBridge.openBrowserSkillInstallPage(target)) as {
        ok?: boolean;
        method?: string;
      };
      if (target === "cli") {
        setHint(
          result?.method === "terminal"
            ? t("extensions.browser_skill_terminal_opened")
            : t("extensions.browser_skill_cli_docs_fallback"),
        );
      } else if (target === "extension") {
        setHint(t("extensions.browser_skill_extension_opened"));
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("settings.unreadable_response"),
      );
    }
  };

  const installCommand =
    status?.installCommand?.trim() || FALLBACK_INSTALL_COMMAND;

  const copyInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      setHint(t("extensions.browser_skill_command_copied"));
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError(t("settings.unreadable_response"));
    }
  };

  const ready = status?.ok === true;
  const cliOk = status?.installed === true;
  const extOk = status?.extensionConnected === true;

  return (
    <div className="space-y-3">
      {/* Compact status bar — dialog already shows name/description above. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusBadge
            tone={ready ? "success" : "warning"}
            shape="soft"
            size="tiny"
          >
            {ready
              ? t("extensions.browser_skill_status_ready")
              : t("extensions.browser_skill_status_setup")}
          </StatusBadge>
          <StatusChip
            label={t("extensions.browser_skill_cli_status")}
            ok={cliOk}
          />
          <StatusChip
            label={t("extensions.browser_skill_ext_status")}
            ok={extOk}
          />
          {status?.version ? (
            <span className="truncate text-2xs text-dls-secondary tabular-nums">
              {status.version}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void refresh()}
          disabled={busy}
          aria-label={t("extensions.browser_skill_run_doctor")}
        >
          <RefreshCw className={busySpinClass(busy)} />
        </Button>
      </div>

      {error ? (
        <NoticeBox tone="error" size="content">
          {error}
        </NoticeBox>
      ) : null}

      {hint ? (
        <NoticeBox tone="info" size="content">
          {hint}
        </NoticeBox>
      ) : null}

      {ready ? (
        <div className="space-y-2 rounded-xl bg-dls-status-success-soft/60 px-3.5 py-3 ring-1 ring-dls-status-success-border/40">
          <div className="flex items-start gap-2">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0 text-dls-status-success-fg"
              aria-hidden
            />
            <p className="text-sm leading-relaxed text-dls-status-success-fg">
              {/* Prefer localized copy — desktop helper returns English status.message. */}
              {t("extensions.browser_skill_ready_message")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-dls-secondary">
            {t("extensions.browser_skill_setup_intro")}
          </p>

          <SetupStep
            step={1}
            title={t("extensions.browser_skill_step_cli_title")}
            description={t("extensions.browser_skill_step_cli_desc")}
            complete={cliOk}
          >
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void openTarget("cli")}
                disabled={cliOk}
              >
                <Terminal className="size-3.5" />
                {cliOk
                  ? t("extensions.browser_skill_status_installed")
                  : t("extensions.browser_skill_open_terminal")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void copyInstallCommand()}
              >
                <Copy className="size-3.5" />
                {copied
                  ? t("extensions.browser_skill_copied")
                  : t("extensions.browser_skill_copy_command")}
              </Button>
            </div>
            {!cliOk ? (
              <pre className="mt-2 max-h-20 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-dls-surface p-2 font-mono text-2xs text-dls-secondary">
                {installCommand}
              </pre>
            ) : null}
          </SetupStep>

          <SetupStep
            step={2}
            title={t("extensions.browser_skill_step_ext_title")}
            description={t("extensions.browser_skill_step_ext_desc")}
            complete={extOk}
          >
            <Button
              type="button"
              size="sm"
              onClick={() => void openTarget("extension")}
              disabled={extOk}
            >
              <ExternalLink className="size-3.5" />
              {extOk
                ? t("extensions.browser_skill_status_connected")
                : t("extensions.browser_skill_install_extension")}
            </Button>
          </SetupStep>

          <SetupStep
            step={3}
            title={t("extensions.browser_skill_step_verify_title")}
            description={t("extensions.browser_skill_step_verify_desc")}
            complete={ready}
          >
            <Button
              type="button"
              size="sm"
              variant={cliOk || extOk ? "default" : "secondary"}
              onClick={() => void refresh()}
              disabled={busy}
            >
              <RefreshCw className={busySpinClass(busy)} />
              {t("extensions.browser_skill_run_doctor")}
            </Button>
            {status?.message && !ready ? (
              <p className="mt-2 text-xs text-dls-secondary">{status.message}</p>
            ) : null}
          </SetupStep>
        </div>
      )}

      {status?.doctorSummary && !ready ? (
        <details className="rounded-lg border border-dls-border/70 bg-dls-surface-muted/50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-dls-text">
            {t("extensions.browser_skill_doctor_details")}
          </summary>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-2xs text-dls-secondary">
            {status.doctorSummary}
          </pre>
        </details>
      ) : null}

      {!ready ? (
        <p className="text-xs leading-relaxed text-dls-secondary">
          {t("extensions.browser_skill_vs_in_app")}
        </p>
      ) : null}
    </div>
  );
}

function StatusChip(props: { label: string; ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium",
        props.ok
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-dls-surface-muted text-dls-secondary",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          props.ok ? "bg-emerald-500" : "bg-dls-border-strong",
        )}
        aria-hidden
      />
      {props.label}
    </span>
  );
}

function SetupStep(props: {
  step: number;
  title: string;
  description: string;
  complete: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-dls-surface-muted/50 px-3 py-2.5 ring-1 ring-dls-border/50">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="flex min-w-0 flex-1 gap-2.5">
          {props.complete ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-dls-accent" />
          ) : (
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-dls-surface text-2xs font-semibold text-dls-secondary ring-1 ring-dls-border">
              {props.step}
            </span>
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-dls-text">{props.title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-dls-secondary">
              {props.description}
            </div>
          </div>
        </div>
        <div className="w-full min-w-0 sm:w-[min(16rem,46%)]">{props.children}</div>
      </div>
    </div>
  );
}
