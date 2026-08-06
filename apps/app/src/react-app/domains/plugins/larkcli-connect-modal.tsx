/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";

import type { LarkCliConnectionStatus } from "@onmyagent/types/lark-cli-auth";
import { LARK_CLI_OPEN_PLATFORM_APP_URL } from "@onmyagent/types/lark-cli-auth";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoticeBox } from "@/components/ui/notice-box";
import { SegmentedTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import {
  cancelLarkCliConfigInit,
  completeLarkCliUserLogin,
  getLarkCliConnectionStatus,
  getLarkCliRecommendedScopesJson,
  startLarkCliConfigInit,
  startLarkCliUserLogin,
  submitLarkCliManualCredentials,
  subscribeLarkCliAuthProgress,
} from "@/app/lib/desktop";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type LarkCliConnectModalProps = {
  open: boolean;
  /** 1 = app credentials, 2 = user login */
  initialStep?: 1 | 2;
  initialTab?: "qr" | "manual";
  onOpenChange: (open: boolean) => void;
  onConnectionChange: (status: LarkCliConnectionStatus) => void;
};

type ConfigTab = "qr" | "manual";

/** Inline action affordance: looks clickable (accent + underline). */
const clickableTextClassName =
  "mac:titlebar-no-drag inline-flex items-center gap-1 font-medium text-dls-accent underline underline-offset-2 transition-opacity hover:opacity-80";

export function LarkCliConnectModal(props: LarkCliConnectModalProps) {
  const [step, setStep] = useState<1 | 2>(props.initialStep ?? 1);
  const [tab, setTab] = useState<ConfigTab>(props.initialTab ?? "qr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 QR
  const [configUrl, setConfigUrl] = useState<string | null>(null);
  const [configQr, setConfigQr] = useState<string | null>(null);

  // Step 1 manual
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [copyDone, setCopyDone] = useState(false);

  // Step 2 login
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [loginQr, setLoginQr] = useState<string | null>(null);
  const [loginSessionId, setLoginSessionId] = useState<string | null>(null);
  const loginStartedRef = useRef(false);

  useEffect(() => {
    if (!props.open) return;
    setStep(props.initialStep ?? 1);
    setTab(props.initialTab ?? "qr");
    setError(null);
    setBusy(false);
    setCopyDone(false);
    setAppId("");
    setAppSecret("");
    setConfigUrl(null);
    setConfigQr(null);
    setLoginUrl(null);
    setLoginQr(null);
    setLoginSessionId(null);
    loginStartedRef.current = false;
  }, [props.open, props.initialStep, props.initialTab]);

  const advanceToLogin = useCallback(
    async (status?: LarkCliConnectionStatus) => {
      if (status) props.onConnectionChange(status);
      else {
        try {
          props.onConnectionChange(await getLarkCliConnectionStatus());
        } catch {
          // ignore
        }
      }
      setStep(2);
      setLoginSessionId(null);
      loginStartedRef.current = false;
    },
    [props],
  );

  const finishLoginSuccess = useCallback(
    async (status?: LarkCliConnectionStatus) => {
      try {
        const next = status ?? (await getLarkCliConnectionStatus());
        props.onConnectionChange(next);
      } catch {
        // ignore
      }
      props.onOpenChange(false);
    },
    [props],
  );

  useEffect(() => {
    if (!props.open) return undefined;
    return subscribeLarkCliAuthProgress((progress) => {
      if (progress.verificationUrl) {
        if (progress.operation === "config_init") {
          setConfigUrl(progress.verificationUrl);
          if (progress.qrcodeDataUrl) setConfigQr(progress.qrcodeDataUrl);
          setBusy(false);
        }
        if (progress.operation === "user_login") {
          setLoginUrl(progress.verificationUrl);
          if (progress.qrcodeDataUrl) setLoginQr(progress.qrcodeDataUrl);
        }
      }
      if (progress.phase === "complete" && progress.operation === "config_init") {
        void advanceToLogin();
      }
      if (progress.phase === "complete" && progress.operation === "user_login") {
        void finishLoginSuccess();
      }
      if (progress.phase === "error" && progress.errorMessage) {
        if (progress.operation === "user_login" || progress.operation === "config_init") {
          setError(progress.errorMessage);
        }
        setBusy(false);
      }
    });
  }, [props.open, advanceToLogin, finishLoginSuccess]);

  const startLoginFlow = useCallback(async () => {
    if (loginStartedRef.current) return;
    loginStartedRef.current = true;
    setBusy(true);
    setError(null);
    setLoginUrl(null);
    setLoginQr(null);
    try {
      const started = await startLarkCliUserLogin();
      if (started.alreadyLoggedIn) {
        await finishLoginSuccess();
        return;
      }
      setLoginSessionId(started.sessionId);
      setLoginUrl(started.verificationUrl);
      setLoginQr(started.qrcodeDataUrl);
      // Background device-code poll is already running in main; also wait here
      // so the button path / IPC errors surface if background fails.
      if (started.sessionId) {
        void completeLarkCliUserLogin(started.sessionId)
          .then((status) => finishLoginSuccess(status))
          .catch((e) => {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
          });
      }
    } catch (e) {
      loginStartedRef.current = false;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [finishLoginSuccess]);

  useEffect(() => {
    if (!props.open || step !== 2) return;
    if (loginStartedRef.current) return;
    void startLoginFlow();
  }, [props.open, step, startLoginFlow]);

  // Step 2: poll until user token is valid, then close modal + refresh card.
  // Complements main-process device-code poll / auth-progress events.
  useEffect(() => {
    if (!props.open || step !== 2) return;
    let stopped = false;
    const tick = async () => {
      try {
        const status = await getLarkCliConnectionStatus();
        if (stopped) return;
        if (status.phase === "connected_logged_in") {
          await finishLoginSuccess(status);
        }
      } catch {
        // keep waiting
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [props.open, step, finishLoginSuccess]);

  // Start config init once per open+QR tab. Do NOT depend on configUrl —
  // otherwise setting the URL re-runs cleanup and kills the waiting process.
  useEffect(() => {
    if (!props.open || step !== 1 || tab !== "qr") return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await startLarkCliConfigInit();
        if (cancelled) return;
        if (result.verificationUrl) setConfigUrl(result.verificationUrl);
        if (result.qrcodeDataUrl) setConfigQr(result.qrcodeDataUrl);
        if (!result.pending && result.exitCode === 0) {
          await advanceToLogin();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      void cancelLarkCliConfigInit();
    };
  }, [props.open, step, tab, advanceToLogin]);

  // Backup: poll local CLI config until app credentials appear after scan.
  useEffect(() => {
    if (!props.open || step !== 1 || tab !== "qr" || !configUrl) return;
    let stopped = false;
    const tick = async () => {
      try {
        const status = await getLarkCliConnectionStatus();
        if (stopped) return;
        if (
          status.phase === "connected_not_logged_in" ||
          status.phase === "connected_logged_in"
        ) {
          await advanceToLogin(status);
        }
      } catch {
        // keep waiting
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [props.open, step, tab, configUrl, advanceToLogin]);

  const handleClose = (open: boolean) => {
    if (!open) {
      void cancelLarkCliConfigInit();
    }
    props.onOpenChange(open);
  };

  const handleCopyScopes = async () => {
    try {
      const json = await getLarkCliRecommendedScopesJson();
      await navigator.clipboard.writeText(json);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleManualContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await submitLarkCliManualCredentials({
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        brand: "feishu",
      });
      setAppSecret("");
      await advanceToLogin(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleLoginComplete = async () => {
    if (!loginSessionId) {
      // Background poll may already have finished; re-check status.
      try {
        const status = await getLarkCliConnectionStatus();
        if (status.phase === "connected_logged_in") {
          await finishLoginSuccess(status);
          return;
        }
      } catch {
        // fall through
      }
      setError(t("plugins.larkcli_login_waiting"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const status = await completeLarkCliUserLogin(loginSessionId);
      await finishLoginSuccess(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSkipLogin = () => {
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-dls-border px-5 py-4 text-left">
          <DialogTitle>{t("plugins.larkcli_connect_title")}</DialogTitle>
          <DialogDescription>{t("plugins.larkcli_connect_subtitle")}</DialogDescription>
          <div className="mt-3 flex gap-2 text-xs text-dls-secondary">
            <span
              className={cn(
                "rounded-full px-2 py-0.5",
                step === 1 ? "bg-dls-surface-muted font-medium text-dls-text" : "",
              )}
            >
              1. {t("plugins.larkcli_step_config")}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5",
                step === 2 ? "bg-dls-surface-muted font-medium text-dls-text" : "",
              )}
            >
              2. {t("plugins.larkcli_step_login")}
            </span>
          </div>
        </DialogHeader>

        <div className="max-h-[min(70vh,560px)] space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <NoticeBox tone="error" role="alert">
              {error}
            </NoticeBox>
          ) : null}

          {step === 1 ? (
            <>
              <SegmentedTabGroup className="w-full">
                <SegmentedTabButton
                  size="tab"
                  active={tab === "qr"}
                  onClick={() => {
                    setTab("qr");
                    setConfigUrl(null);
                    setConfigQr(null);
                  }}
                >
                  {t("plugins.larkcli_tab_qr")}
                </SegmentedTabButton>
                <SegmentedTabButton
                  size="tab"
                  active={tab === "manual"}
                  onClick={() => {
                    setTab("manual");
                    void cancelLarkCliConfigInit();
                  }}
                >
                  {t("plugins.larkcli_tab_manual")}
                </SegmentedTabButton>
              </SegmentedTabGroup>

              {tab === "qr" ? (
                <div className="space-y-3 rounded-xl border border-dls-border bg-dls-surface-muted/40 p-4">
                  <ol className="list-decimal space-y-1.5 pl-4 text-sm text-dls-secondary">
                    <li>{t("plugins.larkcli_qr_step1")}</li>
                    <li>{t("plugins.larkcli_qr_step2")}</li>
                    <li>{t("plugins.larkcli_qr_step3")}</li>
                  </ol>
                  <div className="flex flex-col items-center gap-3 py-2">
                    {configQr ? (
                      <img
                        src={configQr}
                        alt=""
                        className="size-48 rounded-lg bg-white p-2"
                      />
                    ) : (
                      <div className="flex size-48 items-center justify-center rounded-lg bg-dls-surface">
                        {busy ? (
                          <Loader2 className="size-8 animate-spin text-dls-secondary" />
                        ) : (
                          <span className="text-xs text-dls-secondary">
                            {t("plugins.larkcli_qr_waiting")}
                          </span>
                        )}
                      </div>
                    )}
                    {configUrl ? (
                      <button
                        type="button"
                        className={cn(clickableTextClassName, "text-xs")}
                        onClick={() => {
                          window.open(configUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        {t("plugins.larkcli_open_browser_app_auth")}
                      </button>
                    ) : null}
                    <p className="text-center text-xs text-dls-secondary">
                      {t("plugins.larkcli_qr_waiting")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2 rounded-xl border border-dls-border bg-dls-surface-muted/40 p-4 text-sm text-dls-secondary">
                    <p className="font-medium text-dls-text">
                      {t("plugins.larkcli_manual_steps_title")}
                    </p>
                    <ol className="list-decimal space-y-1.5 pl-4">
                      <li>
                        {t("plugins.larkcli_manual_step1_prefix")}{" "}
                        <a
                          href={LARK_CLI_OPEN_PLATFORM_APP_URL}
                          target="_blank"
                          rel="noreferrer"
                          className={clickableTextClassName}
                        >
                          {t("plugins.larkcli_open_platform")}
                          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        </a>
                        {t("plugins.larkcli_manual_step1_suffix")}
                      </li>
                      <li>{t("plugins.larkcli_manual_step2")}</li>
                      <li>
                        {t("plugins.larkcli_manual_step3")}{" "}
                        <button
                          type="button"
                          className={clickableTextClassName}
                          onClick={() => void handleCopyScopes()}
                        >
                          <Copy className="size-3.5 shrink-0" aria-hidden />
                          {copyDone
                            ? t("plugins.larkcli_scopes_copied")
                            : t("plugins.larkcli_copy_scopes")}
                        </button>
                      </li>
                      <li>{t("plugins.larkcli_manual_step4")}</li>
                      <li>{t("plugins.larkcli_manual_step5")}</li>
                    </ol>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="lark-app-id">
                        App ID <span className="text-dls-danger">*</span>
                      </Label>
                      <Input
                        id="lark-app-id"
                        value={appId}
                        onChange={(e) => setAppId(e.target.value)}
                        placeholder="cli_xxxxxxxx"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lark-app-secret">
                        App Secret <span className="text-dls-danger">*</span>
                      </Label>
                      <Input
                        id="lark-app-secret"
                        type="password"
                        value={appSecret}
                        onChange={(e) => setAppSecret(e.target.value)}
                        placeholder="Your Lark App Secret"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3 rounded-xl border border-dls-border bg-dls-surface-muted/40 p-4">
              <p className="text-sm text-dls-secondary">{t("plugins.larkcli_login_hint")}</p>
              <div className="flex flex-col items-center gap-3 py-2">
                {loginQr ? (
                  <img src={loginQr} alt="" className="size-48 rounded-lg bg-white p-2" />
                ) : (
                  <div className="flex size-48 items-center justify-center rounded-lg bg-dls-surface">
                    {busy ? (
                      <Loader2 className="size-8 animate-spin text-dls-secondary" />
                    ) : (
                      <span className="text-xs text-dls-secondary">
                        {t("plugins.larkcli_login_waiting")}
                      </span>
                    )}
                  </div>
                )}
                {loginUrl ? (
                  <button
                    type="button"
                    className={cn(clickableTextClassName, "text-xs")}
                    onClick={() => {
                      window.open(loginUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    {t("plugins.larkcli_open_in_browser")}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-dls-border px-5 py-3">
          {step === 1 ? (
            // No "skip" on step 1 — dialog X is enough to dismiss.
            tab === "manual" ? (
              <Button
                size="sm"
                disabled={busy || !appId.trim() || !appSecret.trim()}
                onClick={() => void handleManualContinue()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("plugins.larkcli_continue")}
              </Button>
            ) : null
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={handleSkipLogin}>
                {t("plugins.larkcli_skip_login")}
              </Button>
              <Button
                size="sm"
                disabled={busy || !loginSessionId}
                onClick={() => void handleLoginComplete()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("plugins.larkcli_i_authorized")}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
