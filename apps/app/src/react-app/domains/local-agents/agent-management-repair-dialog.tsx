/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import {
  personalLocalAgentGetAgentOverrides,
  personalLocalAgentSetAgentOverrides,
  personalLocalAgentTestCustomAgent,
  type AgentManagementAgent,
} from "../../../app/lib/desktop";
import { EnvVarEditor, type EnvVarRow } from "./env-var-editor";

function envRecord(rows: EnvVarRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) result[name] = row.value;
  }
  return result;
}

function envRowsFromRecord(env: Record<string, string> | undefined): EnvVarRow[] {
  if (!env || typeof env !== "object") return [];
  return Object.entries(env).map(([name, value]) => ({ name, value: String(value ?? "") }));
}

type TestStatus = "idle" | "testing" | "success" | "fail_cli" | "fail_acp";

export function AgentManagementRepairDialog(props: {
  agent: AgentManagementAgent;
  workspaceRoot: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [command, setCommand] = useState(props.agent.executablePath ?? "");
  const [env, setEnv] = useState<EnvVarRow[]>([]);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [testDuration, setTestDuration] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await personalLocalAgentGetAgentOverrides({ workspaceRoot: props.workspaceRoot, id: props.agent.id });
        if (cancelled) return;
        const overrides = (result?.overrides ?? {}) as Record<string, unknown>;
        const overrideCommand = typeof overrides.command === "string" ? overrides.command : "";
        const overrideEnv = overrides.env as Record<string, string> | undefined;
        setCommand(overrideCommand || props.agent.executablePath || "");
        setEnv(envRowsFromRecord(overrideEnv));
      } catch {
        if (!cancelled) setCommand(props.agent.executablePath ?? "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.agent.executablePath, props.agent.id, props.workspaceRoot]);

  const handleTestConnection = useCallback(async () => {
    if (!command.trim()) return;
    setTestStatus("testing");
    setTestError(null);
    setTestDuration(0);
    try {
      const result = await personalLocalAgentTestCustomAgent({
        command: command.trim(),
        args: [],
        env: envRecord(env),
        timeoutMs: 8000,
      });
      setTestStatus(result.step === "success" ? "success" : result.step);
      setTestError(result.error);
      setTestDuration(result.durationMs);
    } catch (error) {
      setTestStatus("fail_cli");
      setTestError(error instanceof Error ? error.message : String(error));
    }
  }, [command, env]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await personalLocalAgentSetAgentOverrides({
        workspaceRoot: props.workspaceRoot,
        id: props.agent.id,
        overrides: { command: command.trim(), env: envRecord(env) },
      });
      props.onSaved?.();
      props.onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [command, env, props]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-dls-surface p-0 text-dls-text sm:!max-w-none">
        <DialogHeader className="border-b border-dls-border px-5 py-4">
          <DialogTitle className="truncate text-base font-medium text-dls-text">
            {t("agent_manager.repair_title", { name: props.agent.name })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <p className="text-xs leading-5 text-dls-secondary">{t("agent_manager.repair_description")}</p>

          <label className="block space-y-1 text-xs text-dls-secondary">
            <span>{t("agent_manager.repair_command")}</span>
            <Input
              variant="dls"
              value={command}
              disabled={loading || saving}
              onChange={(event) => setCommand(event.target.value)}
            />
          </label>

          <EnvVarEditor rows={env} disabled={loading || saving} onChange={setEnv} />

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!command.trim() || testStatus === "testing" || loading || saving}
              onClick={handleTestConnection}
            >
              {testStatus === "testing" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("agent_manager.repair_test")}
                </>
              ) : (
                t("agent_manager.repair_test")
              )}
            </Button>
            {testStatus === "success" && (
              <Alert className="border-dls-status-success/40 bg-dls-status-success-soft text-dls-status-success-fg [&>svg]:text-dls-status-success-fg">
                <CheckCircle2 className="size-4" />
                <AlertTitle>{t("local_agent.test_connection_success")}</AlertTitle>
                <AlertDescription className="text-xs">
                  {t("local_agent.test_connection_duration", { ms: testDuration })}
                </AlertDescription>
              </Alert>
            )}
            {testStatus === "fail_cli" && (
              <Alert variant="destructive">
                <XCircle className="size-4" />
                <AlertTitle>{t("local_agent.test_connection_fail_cli")}</AlertTitle>
                {testError && <AlertDescription className="text-xs break-all">{testError}</AlertDescription>}
              </Alert>
            )}
            {testStatus === "fail_acp" && (
              <Alert className="border-dls-status-warning/40 bg-dls-status-warning-soft text-dls-status-warning-fg [&>svg]:text-dls-status-warning-fg">
                <AlertTriangle className="size-4" />
                <AlertTitle>{t("local_agent.test_connection_fail_acp")}</AlertTitle>
                {testError && <AlertDescription className="text-xs break-all">{testError}</AlertDescription>}
              </Alert>
            )}
          </div>

          {saveError ? (
            <Alert variant="destructive">
              <XCircle className="size-4" />
              <AlertDescription className="text-xs break-all">{saveError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" size="sm" disabled={!command.trim() || saving || loading} onClick={handleSave}>
              {t("agent_manager.repair_save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
