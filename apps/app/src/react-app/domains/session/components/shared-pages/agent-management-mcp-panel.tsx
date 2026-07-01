/** @jsxImportSource react */
import { useState } from "react";
import { Check, Download, Loader2, Pencil, Plus, Server, Trash2, X } from "lucide-react";

import { t } from "../../../../../i18n";
import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AgentManagementMcpActionInput, AgentManagementMcpApp, AgentManagementMcpServer, AgentManagementMcpSnapshot } from "../../../../../app/lib/desktop";
import { AgentSkillIcon } from "./agent-skill-icon";
import { SKILL_AGENT_TONES } from "./agent-management-skill-model";

const MCP_APPS: AgentManagementMcpApp[] = ["claude", "codex", "gemini", "opencode", "hermes"];
const MCP_APP_LABELS: Record<AgentManagementMcpApp, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini", opencode: "OpenCode", hermes: "Hermes" };
const EMPTY_APPS = MCP_APPS.reduce((acc, app) => ({ ...acc, [app]: false }), {} as Record<AgentManagementMcpApp, boolean>);

type McpDraft = { id: string; name: string; description: string; type: "stdio" | "http" | "sse"; command: string; args: string; env: string; url: string; headers: string; apps: Record<AgentManagementMcpApp, boolean> };
const EMPTY_DRAFT: McpDraft = { id: "", name: "", description: "", type: "stdio", command: "", args: "", env: "{}", url: "", headers: "{}", apps: EMPTY_APPS };

function draftFromServer(server: AgentManagementMcpServer): McpDraft {
  return {
    id: server.id,
    name: server.name,
    description: server.description ?? "",
    type: server.server.type ?? "stdio",
    command: typeof server.server.command === "string" ? server.server.command : "",
    args: Array.isArray(server.server.args) ? server.server.args.join("\n") : "",
    env: JSON.stringify(server.server.env ?? {}, null, 2),
    url: typeof server.server.url === "string" ? server.server.url : "",
    headers: JSON.stringify(server.server.headers ?? {}, null, 2),
    apps: { ...EMPTY_APPS, ...server.apps },
  };
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON must be an object");
  return parsed as Record<string, string>;
}

function inputFromDraft(draft: McpDraft): AgentManagementMcpActionInput {
  const server = draft.type === "stdio"
    ? { type: draft.type, command: draft.command.trim(), args: draft.args.split("\n").map((item) => item.trim()).filter(Boolean), env: parseJsonObject(draft.env) }
    : { type: draft.type, url: draft.url.trim(), headers: parseJsonObject(draft.headers) };
  return { action: "save", server: { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), description: draft.description.trim() || null, server, apps: draft.apps } };
}

function McpAppToggle(props: { app: AgentManagementMcpApp; enabled: boolean; busy: boolean; onToggle: () => void }) {
  const tone = SKILL_AGENT_TONES[props.app] ?? SKILL_AGENT_TONES.unknown;
  const label = MCP_APP_LABELS[props.app];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "group/mcp-app flex size-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              props.enabled
                ? cn("border-transparent ring-1", tone.iconActive, tone.active)
                : "border-dls-border bg-dls-surface text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
            )}
            aria-label={label}
            onClick={props.onToggle}
            disabled={props.busy}
          >
            {props.busy ? <Loader2 className="size-3 animate-spin" /> : <AgentSkillIcon agent={props.app} />}
          </button>
        }
      />
      <TooltipContent side="bottom"><span>{label}</span></TooltipContent>
    </Tooltip>
  );
}

export function AgentManagementMcpPanel(props: {
  snapshot: AgentManagementMcpSnapshot | null;
  busyKey: string | null;
  onMcpAction: (input: AgentManagementMcpActionInput, busyKey: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const servers = props.snapshot?.servers ?? [];

  const submit = () => {
    if (!draft) return;
    setDraftError(null);
    try {
      void props.onMcpAction(inputFromDraft(draft), `mcp:save:${draft.id}`).then(() => setDraft(null));
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="grid min-h-[520px] gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dls-border bg-dls-surface p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium"><Server className="size-4" />{t("agent_manager.mcp.title")}</div>
            <p className="mt-1 text-xs text-dls-secondary">{t("agent_manager.mcp.desc")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void props.onMcpAction({ action: "import" }, "mcp:import") } disabled={props.busyKey === "mcp:import"}>
              {props.busyKey === "mcp:import" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t("agent_manager.mcp.import_all")}
            </Button>
            <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT, apps: { ...EMPTY_APPS } })}>
              <Plus className="size-4" />{t("agent_manager.mcp.add")}
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-5">
          {MCP_APPS.map((app) => (
            <div key={app} className="rounded-lg border border-dls-border bg-dls-surface px-3 py-2">
              <div className="text-xs text-dls-secondary">{MCP_APP_LABELS[app]}</div>
              <div className="mt-1 text-base font-medium">{props.snapshot?.countsByApp[app] ?? 0}</div>
            </div>
          ))}
        </div>

        {servers.length === 0 ? (
          <NoticeBox size="comfortable">{t("agent_manager.mcp.empty")}</NoticeBox>
        ) : (
          <div className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface">
            {servers.map((server) => (
              <div key={server.id} className="grid gap-3 border-b border-dls-border p-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{server.name}</span><span className="rounded bg-dls-muted px-1.5 py-0.5 text-xs text-dls-secondary">{server.server.type ?? "stdio"}</span></div>
                  <div className="mt-1 truncate text-xs text-dls-secondary">{server.description || server.id}</div>
                </div>
                <div className="flex items-center gap-1">
                  {MCP_APPS.map((app) => (
                    <McpAppToggle
                      key={app}
                      app={app}
                      enabled={server.apps[app]}
                      busy={props.busyKey === `mcp:toggle:${server.id}:${app}`}
                      onToggle={() => void props.onMcpAction({ action: "toggle", id: server.id, app, enabled: !server.apps[app] }, `mcp:toggle:${server.id}:${app}`)}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" title={t("common.edit")} onClick={() => setDraft(draftFromServer(server))}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" title={t("common.delete")} onClick={() => void props.onMcpAction({ action: "delete", id: server.id }, `mcp:delete:${server.id}`)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <aside className="min-w-0 rounded-lg border border-dls-border bg-dls-surface p-4">
        {draft ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{draft.id ? t("agent_manager.mcp.edit") : t("agent_manager.mcp.add")}</h3>
              <Button variant="ghost" size="icon-sm" onClick={() => setDraft(null)}><X className="size-4" /></Button>
            </div>
            {draftError ? <NoticeBox tone="error" size="content">{draftError}</NoticeBox> : null}
            <input className="w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 text-sm" placeholder="id" value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} disabled={servers.some((server) => server.id === draft.id)} />
            <input className="w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 text-sm" placeholder={t("agent_manager.mcp.name")} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            <textarea className="h-16 w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 text-sm" placeholder={t("agent_manager.mcp.description")} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            <select className="w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 text-sm" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as McpDraft["type"] })}>
              <option value="stdio">stdio</option><option value="sse">sse</option><option value="http">http</option>
            </select>
            {draft.type === "stdio" ? (
              <>
                <input className="w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 text-sm" placeholder="command" value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} />
                <textarea className="h-24 w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 font-mono text-xs" placeholder="args" value={draft.args} onChange={(event) => setDraft({ ...draft, args: event.target.value })} />
                <textarea className="h-24 w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 font-mono text-xs" placeholder="env JSON" value={draft.env} onChange={(event) => setDraft({ ...draft, env: event.target.value })} />
              </>
            ) : (
              <>
                <input className="w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 text-sm" placeholder="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
                <textarea className="h-24 w-full rounded-md border border-dls-border bg-dls-background px-3 py-2 font-mono text-xs" placeholder="headers JSON" value={draft.headers} onChange={(event) => setDraft({ ...draft, headers: event.target.value })} />
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {MCP_APPS.map((app) => <McpAppToggle key={app} app={app} enabled={draft.apps[app]} busy={false} onToggle={() => setDraft({ ...draft, apps: { ...draft.apps, [app]: !draft.apps[app] } })} />)}
            </div>
            <Button className="w-full" onClick={submit} disabled={props.busyKey === `mcp:save:${draft.id}`}>
              {props.busyKey === `mcp:save:${draft.id}` ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("agent_manager.mcp.save")}
            </Button>
          </div>
        ) : (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center text-sm text-dls-secondary">
            <Server className="mb-3 size-8" />
            {t("agent_manager.mcp.select_hint")}
          </div>
        )}
      </aside>
    </section>
  );
}
