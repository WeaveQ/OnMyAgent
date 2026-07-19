/** @jsxImportSource react */
import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, XCircle, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NoticeBox } from "@/components/ui/notice-box";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SelectMenu } from "../../design-system/select-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import type { PersonalLocalAgent, PersonalLocalAgentTestCustomAgentResult } from "../../../app/lib/desktop";
import { personalLocalAgentTestCustomAgent } from "../../../app/lib/desktop";
import { EnvVarEditor, type EnvVarRow } from "./env-var-editor";

export type InlineAgentEditorValue = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description: string;
  nativeSkillsDirs: string[];
  behaviorPolicy: Record<string, unknown>;
  connectionType: "cli" | "raw";
  acpArgs: string[];
  supportsStreaming: boolean;
  supportsResume: boolean;
  supportsApproval: boolean;
  supportsModelOverride: boolean;
  authRequired: boolean;
};

type EditableAgentFields = PersonalLocalAgent & {
  description?: string | null;
  env?: Record<string, string> | Array<{ name: string; value: string }>;
  nativeSkillsDirs?: string[];
  behaviorPolicy?: Record<string, unknown> | null;
  connectionType?: "cli" | "raw" | null;
  acpArgs?: string[];
  supportsStreaming?: boolean;
  supportsResume?: boolean;
  supportsApproval?: boolean;
  supportsModelOverride?: boolean;
  authRequired?: boolean;
};

function splitArgs(value: string): string[] {
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function envRows(env: EditableAgentFields["env"]): EnvVarRow[] {
  if (Array.isArray(env)) return env.map((row) => ({ name: row.name, value: row.value }));
  if (!env || typeof env !== "object") return [];
  return Object.entries(env).map(([name, value]) => ({ name, value: String(value ?? "") }));
}

function parseBehaviorPolicy(value: string): { value: Record<string, unknown>; error: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { value: {}, error: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: {}, error: t("local_agent.editor_error_behavior_policy") };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: {}, error: t("local_agent.editor_error_behavior_policy") };
  }
}

function envRecord(rows: EnvVarRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) result[name] = row.value;
  }
  return result;
}

const labelClass = "text-xs font-medium text-dls-secondary";
const fieldHintClass = "text-xs leading-tight text-dls-text-tertiary";
const sectionClass =
  "space-y-3 rounded-xl border border-dls-border bg-dls-surface p-4";

export function InlineAgentEditor(props: {
  agent?: PersonalLocalAgent | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (value: InlineAgentEditorValue) => void;
  /** When true, omit outer chrome (dialog already provides surface). */
  embedded?: boolean;
}) {
  // Callers pass agent objects that may carry richer editor-only fields (description,
  // env map, nativeSkillsDirs, behaviorPolicy) not exposed on the public PersonalLocalAgent type.
  const editableAgent = props.agent as EditableAgentFields | null | undefined;
  const [id, setId] = useState(editableAgent?.id ?? "");
  const [name, setName] = useState(editableAgent?.name ?? "");
  const [command, setCommand] = useState(editableAgent?.executablePath ?? "");
  const [args, setArgs] = useState(Array.isArray(editableAgent?.customArgs) ? editableAgent.customArgs.join(" ") : "");
  const [description, setDescription] = useState(String(editableAgent?.description ?? ""));
  const [nativeSkillsDirs, setNativeSkillsDirs] = useState(Array.isArray(editableAgent?.nativeSkillsDirs) ? editableAgent.nativeSkillsDirs.join("\n") : "");
  const [behaviorPolicy, setBehaviorPolicy] = useState(editableAgent?.behaviorPolicy ? JSON.stringify(editableAgent.behaviorPolicy, null, 2) : "");
  const [env, setEnv] = useState<EnvVarRow[]>(envRows(editableAgent?.env));
  const [connectionType, setConnectionType] = useState<"cli" | "raw">(editableAgent?.connectionType === "cli" ? "cli" : editableAgent?.connectionType === "raw" ? "raw" : "raw");
  const [acpArgs, setAcpArgs] = useState(Array.isArray(editableAgent?.acpArgs) ? editableAgent.acpArgs.join(" ") : "");
  const [supportsStreaming, setSupportsStreaming] = useState<boolean>(editableAgent?.supportsStreaming === true);
  const [supportsResume, setSupportsResume] = useState<boolean>(editableAgent?.supportsResume === true);
  const [supportsApproval, setSupportsApproval] = useState<boolean>(editableAgent?.supportsApproval === true);
  const [supportsModelOverride, setSupportsModelOverride] = useState<boolean>(editableAgent?.supportsModelOverride === true);
  const [authRequired, setAuthRequired] = useState<boolean>(editableAgent?.authRequired === true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  type TestStatus = "idle" | "testing" | "success" | "fail_cli" | "fail_acp";
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [testDuration, setTestDuration] = useState<number>(0);

  const handleTestConnection = useCallback(async () => {
    if (!command.trim()) return;
    setTestStatus("testing");
    setTestError(null);
    setTestDuration(0);
    try {
      const result: PersonalLocalAgentTestCustomAgentResult = await personalLocalAgentTestCustomAgent({
        command: command.trim(),
        acpArgs: connectionType === "cli" ? splitArgs(acpArgs) : undefined,
        args: splitArgs(args),
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
  }, [command, acpArgs, args, env, connectionType]);

  const validation = useMemo(() => {
    if (!id.trim()) return t("local_agent.editor_error_id");
    if (!name.trim()) return t("local_agent.editor_error_name");
    if (!command.trim()) return t("local_agent.editor_error_command");
    if (env.some((row) => !row.name.trim())) return t("local_agent.editor_error_env");
    const parsedPolicy = parseBehaviorPolicy(behaviorPolicy);
    if (parsedPolicy.error) return parsedPolicy.error;
    return null;
  }, [behaviorPolicy, command, env, id, name]);

  const save = () => {
    if (validation) return;
    const parsedPolicy = parseBehaviorPolicy(behaviorPolicy);
    props.onSave({
      id: id.trim(),
      name: name.trim(),
      command: command.trim(),
      args: splitArgs(args),
      env: envRecord(env),
      description: description.trim(),
      nativeSkillsDirs: nativeSkillsDirs.split(/\n+/).map((item) => item.trim()).filter(Boolean),
      behaviorPolicy: parsedPolicy.value,
      connectionType,
      acpArgs: splitArgs(acpArgs),
      supportsStreaming,
      supportsResume,
      supportsApproval,
      supportsModelOverride,
      authRequired,
    });
  };

  return (
    <form
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        !props.embedded && "rounded-xl border border-dls-border bg-dls-surface",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto", props.embedded ? "px-0 py-0" : "p-4")}>
        {/* Basic — always visible */}
        <section className={sectionClass}>
          <div>
            <h3 className="text-sm font-medium text-dls-text">{t("local_agent.editor_section_basic")}</h3>
            <p className="mt-0.5 text-xs text-dls-secondary">{t("local_agent.editor_section_basic_desc")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={labelClass}>{t("local_agent.editor_id")}</span>
              <Input
                data-testid="local-agent-editor-id"
                variant="dls"
                value={id}
                disabled={props.busy || Boolean(props.agent)}
                onChange={(event) => setId(event.target.value)}
                placeholder={t("local_agent.editor_id_placeholder")}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelClass}>{t("local_agent.editor_name")}</span>
              <Input
                data-testid="local-agent-editor-name"
                variant="dls"
                value={name}
                disabled={props.busy}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("local_agent.editor_name_placeholder")}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelClass}>{t("local_agent.editor_command")}</span>
              <Input
                data-testid="local-agent-editor-command"
                variant="dls"
                value={command}
                disabled={props.busy}
                onChange={(event) => setCommand(event.target.value)}
                placeholder={t("local_agent.editor_command_placeholder")}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelClass}>{t("local_agent.editor_args")}</span>
              <Input
                data-testid="local-agent-editor-args"
                variant="dls"
                value={args}
                disabled={props.busy}
                onChange={(event) => setArgs(event.target.value)}
                placeholder={t("local_agent.editor_args_placeholder")}
              />
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <span className={labelClass}>{t("local_agent.editor_description")}</span>
              <Textarea
                data-testid="local-agent-editor-description"
                className="min-h-16 resize-y bg-dls-surface"
                value={description}
                disabled={props.busy}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("local_agent.editor_description_placeholder")}
              />
            </label>
          </div>
        </section>

        {/* Environment / skills */}
        <section className={sectionClass}>
          <div>
            <h3 className="text-sm font-medium text-dls-text">{t("local_agent.editor_section_runtime")}</h3>
            <p className="mt-0.5 text-xs text-dls-secondary">{t("local_agent.editor_section_runtime_desc")}</p>
          </div>
          <EnvVarEditor rows={env} disabled={props.busy} onChange={setEnv} />
          <label className="block space-y-1.5">
            <span className={labelClass}>{t("local_agent.editor_native_skills_dirs")}</span>
            <Textarea
              data-testid="local-agent-editor-native-skills"
              variant="dlsMono"
              className="min-h-16 resize-y text-xs"
              value={nativeSkillsDirs}
              disabled={props.busy}
              onChange={(event) => setNativeSkillsDirs(event.target.value)}
              placeholder={t("local_agent.editor_native_skills_dirs_placeholder")}
            />
          </label>
        </section>

        {/* ACP */}
        <section className={sectionClass} data-testid="local-agent-editor-acp">
          <div>
            <h3 className="text-sm font-medium text-dls-text">{t("local_agent.editor_acp_section")}</h3>
            <p className="mt-0.5 text-xs text-dls-secondary">{t("local_agent.editor_section_acp_desc")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={labelClass}>{t("local_agent.editor_connection_type")}</span>
              <SelectMenu
                size="compact"
                ariaLabel={t("local_agent.editor_connection_type")}
                options={[
                  { value: "raw", label: t("local_agent.editor_connection_raw") },
                  { value: "cli", label: t("local_agent.editor_connection_cli") },
                ]}
                value={connectionType}
                onChange={(value) => setConnectionType(value === "cli" ? "cli" : "raw")}
                disabled={props.busy}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelClass}>{t("local_agent.editor_acp_args")}</span>
              <Input
                data-testid="local-agent-editor-acp-args"
                variant="dls"
                value={acpArgs}
                disabled={props.busy || connectionType !== "cli"}
                onChange={(event) => setAcpArgs(event.target.value)}
                placeholder="--acp"
              />
              <p className={fieldHintClass}>{t("local_agent.editor_acp_args_hint")}</p>
            </label>
          </div>
        </section>

        {/* Advanced — collapsed by default */}
        <section className={sectionClass}>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 text-left"
            onClick={() => setAdvancedOpen((value) => !value)}
            aria-expanded={advancedOpen}
          >
            {advancedOpen ? (
              <ChevronDown className="size-3.5 shrink-0 text-dls-secondary" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" />
            )}
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-dls-text">{t("local_agent.editor_section_advanced")}</h3>
              <p className="mt-0.5 text-xs text-dls-secondary">{t("local_agent.editor_section_advanced_desc")}</p>
            </div>
          </button>
          {advancedOpen ? (
            <div className="space-y-3 border-t border-dls-border pt-3">
              <label className="block space-y-1.5">
                <span className={labelClass}>{t("local_agent.editor_behavior_policy")}</span>
                <Textarea
                  data-testid="local-agent-editor-behavior-policy"
                  variant="dlsMono"
                  className="min-h-20 resize-y text-xs"
                  value={behaviorPolicy}
                  disabled={props.busy}
                  onChange={(event) => setBehaviorPolicy(event.target.value)}
                  placeholder={t("local_agent.editor_behavior_policy_placeholder")}
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="inline-flex items-center gap-2 text-xs text-dls-secondary">
                  <Checkbox
                    checked={supportsStreaming}
                    disabled={props.busy || connectionType !== "cli"}
                    onCheckedChange={(checked) => setSupportsStreaming(checked === true)}
                  />
                  <span>{t("local_agent.editor_supports_streaming")}</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-dls-secondary">
                  <Checkbox
                    checked={supportsResume}
                    disabled={props.busy || connectionType !== "cli"}
                    onCheckedChange={(checked) => setSupportsResume(checked === true)}
                  />
                  <span>{t("local_agent.editor_supports_resume")}</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-dls-secondary">
                  <Checkbox
                    checked={supportsApproval}
                    disabled={props.busy || connectionType !== "cli"}
                    onCheckedChange={(checked) => setSupportsApproval(checked === true)}
                  />
                  <span>{t("local_agent.editor_supports_approval")}</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-dls-secondary">
                  <Checkbox
                    checked={supportsModelOverride}
                    disabled={props.busy || connectionType !== "cli"}
                    onCheckedChange={(checked) => setSupportsModelOverride(checked === true)}
                  />
                  <span>{t("local_agent.editor_supports_model_override")}</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-dls-secondary">
                  <Checkbox
                    checked={authRequired}
                    disabled={props.busy || connectionType !== "cli"}
                    onCheckedChange={(checked) => setAuthRequired(checked === true)}
                  />
                  <span>{t("local_agent.editor_auth_required")}</span>
                </label>
              </div>
            </div>
          ) : null}
        </section>

        {/* Test connection feedback lives in body so sticky footer stays clean */}
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
            {testError ? (
              <AlertDescription className="break-all text-xs">{testError}</AlertDescription>
            ) : null}
          </Alert>
        )}
        {testStatus === "fail_acp" && (
          <Alert className="border-dls-status-warning/40 bg-dls-status-warning-soft text-dls-status-warning-fg [&>svg]:text-dls-status-warning-fg">
            <AlertTriangle className="size-4" />
            <AlertTitle>{t("local_agent.test_connection_fail_acp")}</AlertTitle>
            {testError ? (
              <AlertDescription className="break-all text-xs">{testError}</AlertDescription>
            ) : null}
          </Alert>
        )}
        {validation || props.error ? (
          <NoticeBox tone="error">{validation || props.error}</NoticeBox>
        ) : null}
      </div>

      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-dls-border bg-dls-surface",
          props.embedded ? "px-5 py-3" : "px-4 py-3",
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mr-auto"
          disabled={!command.trim() || testStatus === "testing" || props.busy}
          onClick={() => void handleTestConnection()}
          data-testid="local-agent-editor-test-connection"
        >
          {testStatus === "testing" ? (
            <>
              <LoadingSpinner size="default" />
              {t("local_agent.test_connection_testing")}
            </>
          ) : (
            t("local_agent.test_connection")
          )}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={props.busy} onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={Boolean(validation) || props.busy}
          data-testid="local-agent-editor-save"
        >
          {props.busy ? <LoadingSpinner size="sm" className="mr-1.5" /> : null}
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
