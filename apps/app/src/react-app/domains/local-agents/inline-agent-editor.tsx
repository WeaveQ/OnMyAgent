/** @jsxImportSource react */
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NoticeBox } from "@/components/ui/notice-box";
import { t } from "@/i18n";
import type { PersonalLocalAgent } from "../../../app/lib/desktop";
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
};

type EditableAgentFields = PersonalLocalAgent & {
  description?: string | null;
  env?: Record<string, string> | Array<{ name: string; value: string }>;
  nativeSkillsDirs?: string[];
  behaviorPolicy?: Record<string, unknown> | null;
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

export function InlineAgentEditor(props: {
  agent?: PersonalLocalAgent | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (value: InlineAgentEditorValue) => void;
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
    if (validation || props.busy) return;
    props.onSave({
      id: id.trim(),
      name: name.trim(),
      command: command.trim(),
      args: splitArgs(args),
      env: envRecord(env),
      description: description.trim(),
      nativeSkillsDirs: nativeSkillsDirs.split(/\n+/).map((item) => item.trim()).filter(Boolean),
      behaviorPolicy: parseBehaviorPolicy(behaviorPolicy).value,
    });
  };

  return (
    <form className="space-y-3 rounded-lg border border-dls-border bg-dls-surface-muted/35 p-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-dls-secondary">
          <span>{t("local_agent.editor_id")}</span>
          <Input data-testid="local-agent-editor-id" variant="dls" value={id} disabled={props.busy || Boolean(props.agent)} onChange={(event) => setId(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-dls-secondary">
          <span>{t("local_agent.editor_name")}</span>
          <Input data-testid="local-agent-editor-name" variant="dls" value={name} disabled={props.busy} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-dls-secondary">
          <span>{t("local_agent.editor_command")}</span>
          <Input data-testid="local-agent-editor-command" variant="dls" value={command} disabled={props.busy} onChange={(event) => setCommand(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-dls-secondary">
          <span>{t("local_agent.editor_args")}</span>
          <Input data-testid="local-agent-editor-args" variant="dls" value={args} disabled={props.busy} onChange={(event) => setArgs(event.target.value)} />
        </label>
      </div>
      <label className="block space-y-1 text-xs text-dls-secondary">
        <span>{t("local_agent.editor_description")}</span>
        <Textarea data-testid="local-agent-editor-description" className="min-h-20 resize-y bg-dls-surface" value={description} disabled={props.busy} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <EnvVarEditor rows={env} disabled={props.busy} onChange={setEnv} />
      <label className="block space-y-1 text-xs text-dls-secondary">
        <span>{t("local_agent.editor_native_skills_dirs")}</span>
        <Textarea data-testid="local-agent-editor-native-skills" variant="dlsMono" className="min-h-20 resize-y text-xs" value={nativeSkillsDirs} disabled={props.busy} onChange={(event) => setNativeSkillsDirs(event.target.value)} />
      </label>
      <label className="block space-y-1 text-xs text-dls-secondary">
        <span>{t("local_agent.editor_behavior_policy")}</span>
        <Textarea data-testid="local-agent-editor-behavior-policy" variant="dlsMono" className="min-h-20 resize-y text-xs" value={behaviorPolicy} disabled={props.busy} onChange={(event) => setBehaviorPolicy(event.target.value)} />
      </label>
      {validation || props.error ? <NoticeBox tone="error">{validation || props.error}</NoticeBox> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={props.busy} onClick={props.onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" size="sm" disabled={Boolean(validation) || props.busy} data-testid="local-agent-editor-save">{t("common.save")}</Button>
      </div>
    </form>
  );
}
