import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useMemo } from "react";
import { Copy, Download, FileText, FolderOpen, Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconTile, MatrixButton, MenuRowButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { EmptyStateBox } from "@/components/ui/notice-box";
import { BadgeDot, CountBadge, StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import type { AgentManagementSkill, AgentManagementSkillAgent } from "../../../../app/lib/desktop";
import {
  skillAgentLabel,
  SKILL_AGENT_TONES,
  STUDIO_SWITCH_SKILL_AGENT_OPTIONS,
} from "./agent-management-skill-model";
import { AgentSkillIcon } from "../../../design-system/agent-skill-icon";

type SkillCellState = "native" | "managed" | "available" | "readonly" | "busy";

const SKILL_MATRIX_GRID_STYLE = { gridTemplateColumns: "minmax(0,1fr) repeat(6, 44px) 56px" };

function SkillStateGlyph(props: { state: Exclude<SkillCellState, "busy">; toneDot?: string; borderColor?: string; size?: "cell" | "legend" }) {
  const sizeClass = props.size === "legend" ? "size-4 text-xs" : "size-5 text-xs";
  const markerSizeClass = props.size === "legend" ? "size-1" : "size-1.5";
  if (props.state === "native") {
    return (
      <span className={cn("flex items-center justify-center rounded-full font-medium leading-none text-white", sizeClass, "bg-dls-online")}>
        ✓
      </span>
    );
  }
  if (props.state === "managed") {
    return (
      <span className={cn("relative flex items-center justify-center rounded-full border-2 border-dls-accent bg-dls-surface font-medium leading-none text-dls-accent", sizeClass)}>
        <span className={cn("absolute -right-0.5 -top-0.5 rounded-full bg-dls-accent", markerSizeClass)} />✓
      </span>
    );
  }
  if (props.state === "available") {
    return (
      <span className={cn("flex items-center justify-center rounded-full border border-dls-border-strong font-medium leading-none", sizeClass, props.size === "legend" ? "text-dls-secondary" : "text-transparent transition-colors group-hover/cell:border-dls-secondary group-hover/cell:text-dls-secondary")}>
        +
      </span>
    );
  }
  return <span className="h-0.5 w-3 rounded-full bg-dls-border-strong" />;
}

function SkillMatrixCell(props: {
  state: SkillCellState;
  agent: AgentManagementSkillAgent;
  tooltip: string;
  onClick?: () => void;
}) {
  const tone = SKILL_AGENT_TONES[props.agent] ?? SKILL_AGENT_TONES.unknown;
  const interactive = props.state === "native" || props.state === "managed" || props.state === "available";
  const borderColor = tone.dot.replace("bg-", "border-");
  let glyph: React.ReactNode;
  if (props.state === "busy") {
    glyph = <LoadingSpinner size="sm" className="text-dls-secondary" />;
  } else if (props.state === "native") {
    glyph = <SkillStateGlyph state="native" toneDot={tone.dot} />;
  } else if (props.state === "managed") {
    glyph = <SkillStateGlyph state="managed" toneDot={tone.dot} borderColor={borderColor} />;
  } else if (props.state === "available") {
    glyph = <SkillStateGlyph state="available" />;
  } else {
    glyph = <SkillStateGlyph state="readonly" />;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <MatrixButton
            type="button"
            disabled={!interactive}
            onClick={interactive ? props.onClick : undefined}
            interactive={interactive}
            className={cn(props.state === "managed" && tone.iconActive, props.state === "native" && "hover:brightness-95")}
            aria-label={props.tooltip}
          >
            {glyph}
          </MatrixButton>
        }
      />
      <TooltipContent side="bottom"><span>{props.tooltip}</span></TooltipContent>
    </Tooltip>
  );
}

function SkillMatrixColumnHeader(props: {
  agent: AgentManagementSkillAgent;
  active: boolean;
  count: number;
  onToggle: (event: React.MouseEvent) => void;
}) {
  const tone = SKILL_AGENT_TONES[props.agent] ?? SKILL_AGENT_TONES.unknown;
  const label = skillAgentLabel(props.agent);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <MatrixButton
            type="button"
            kind="header"
            onClick={props.onToggle}
            active={props.active}
            className={cn(props.active && tone.iconActive)}
            aria-pressed={props.active}
            aria-label={t("skills.matrix_column_label", {
              label,
              count: props.count,
              filtered: props.active ? t("skills.matrix_filtered_suffix") : "",
            })}
          >
            <span className="flex size-4 items-center justify-center">
              <AgentSkillIcon agent={props.agent} />
            </span>
            <span className="tabular-nums leading-none">{props.count}</span>
          </MatrixButton>
        }
      />
      <TooltipContent side="bottom"><span>{t("skills.matrix_column_tooltip", { label })}</span></TooltipContent>
    </Tooltip>
  );
}

function getSkillCellState(
  skill: AgentManagementSkill,
  agent: AgentManagementSkillAgent,
  busyKey: string | null,
): { state: SkillCellState; tooltip: string } {
  const enabled = skill.agents.includes(agent);
  const ownsSource = skill.sources.some((source) => source.agent === agent && source.path === skill.path && !source.managedByStudioSwitch);
  const sourceKind = skill.kind ?? skill.sources.find((source) => source.kind)?.kind ?? "skill";
  const canSync = sourceKind === "skill" && skill.sources.some((source) => source.kind !== "runtime-skill" && source.kind !== "slash-command");
  const busy = busyKey === `${skill.path}:${agent}`;
  const label = skillAgentLabel(agent);
  if (busy) return { state: "busy", tooltip: t("skills.matrix_tooltip_busy", { label }) };
  if (enabled && ownsSource) return { state: "native", tooltip: t("skills.matrix_tooltip_native", { label }) };
  if (enabled) return { state: "managed", tooltip: t("skills.matrix_tooltip_managed", { label }) };
  if (!canSync) return { state: "readonly", tooltip: t("skills.matrix_tooltip_readonly", { label }) };
  return { state: "available", tooltip: t("skills.matrix_tooltip_available", { label }) };
}

function SkillAgentCluster(props: { skill: AgentManagementSkill }) {
  const enabledAgents = STUDIO_SWITCH_SKILL_AGENT_OPTIONS.filter((agent) => props.skill.agents.includes(agent));
  const visibleLimit = enabledAgents.length > 3 ? 2 : 3;
  const visibleAgents = enabledAgents.slice(0, visibleLimit);
  const overflow = enabledAgents.length - visibleAgents.length;
  const label = enabledAgents.length > 0
    ? enabledAgents.map((agent) => skillAgentLabel(agent)).join(" / ")
    : t("skills.matrix_no_enabled_agents");
  const ringTone = props.skill.readonly
    ? "ring-dls-border-strong"
    : props.skill.managedByStudioSwitch
      ? "ring-dls-accent/30"
      : "ring-dls-border-strong";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn(
              "flex h-8 w-14 shrink-0 items-center justify-start overflow-hidden rounded-lg bg-dls-surface-muted pl-1.5 ring-1",
              ringTone,
            )}
            aria-label={label}
          >
            {visibleAgents.length > 0 ? (
              <div className="flex items-center">
                {visibleAgents.map((agent, index) => (
                  <span
                    key={agent}
                    className={cn(
                      "flex size-4.5 items-center justify-center rounded-full border border-dls-surface bg-dls-surface",
                      index > 0 && "-ml-[5px]",
                    )}
                    style={{ zIndex: 10 - index }}
                  >
                    <AgentSkillIcon agent={agent} />
                  </span>
                ))}
                {overflow > 0 ? (
                  <BadgeDot className="-ml-[5px] border border-dls-surface" size="sm">
                    +{overflow}
                  </BadgeDot>
                ) : null}
              </div>
            ) : (
              <span className="size-4.5 rounded-full border border-dashed border-dls-border-strong bg-dls-surface" />
            )}
          </div>
        }
      />
      <TooltipContent side="bottom"><span>{label}</span></TooltipContent>
    </Tooltip>
  );
}

function SkillMatrixRow(props: {
  skill: AgentManagementSkill;
  busyKey: string | null;
  selected: boolean;
  onSkillAction: (skill: AgentManagementSkill, agent: AgentManagementSkillAgent, action: "enable" | "disable" | "open" | "import") => void;
  onOpenDetail: (skill: AgentManagementSkill) => void;
}) {
  const sourceLabels = Array.from(new Set(props.skill.sources.map((source) => source.label)));
  const sourceSummary = sourceLabels.length > 0 ? sourceLabels.join(" / ") : props.skill.scopeLabel;
  const pathSummary = props.skill.sources[0]?.path ?? props.skill.path;
  const title = props.skill.displayNameZh || props.skill.displayNameEn || props.skill.name;
  const description = props.skill.descriptionZh || props.skill.descriptionEn || props.skill.description || "";
  const sourceKind = props.skill.kind ?? props.skill.sources.find((source) => source.kind)?.kind ?? "skill";
  const sourceKindLabel = sourceKind === "runtime-skill" ? "Runtime" : sourceKind === "slash-command" ? "Slash" : sourceKind === "plugin" ? "Plugin" : null;
  const importAgent = props.skill.agents.find((agent) => STUDIO_SWITCH_SKILL_AGENT_OPTIONS.includes(agent)) ?? props.skill.sources.find((source) => STUDIO_SWITCH_SKILL_AGENT_OPTIONS.includes(source.agent))?.agent ?? "claude";
  const importBusy = props.busyKey === `${props.skill.path}:${importAgent}:import`;
  return (
    <div
      className={cn(
        "group grid items-stretch border-b border-dls-border text-xs transition-colors",
        props.selected ? "bg-dls-hover" : "hover:bg-dls-hover",
      )}
      style={SKILL_MATRIX_GRID_STYLE}
    >
      <MenuRowButton
        type="button"
        onClick={() => props.onOpenDetail(props.skill)}
        align="center" className="min-w-0 px-4"
      >
        <SkillAgentCluster skill={props.skill} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-dls-text">{title}</span>
            {title !== props.skill.name ? (
              <span className="shrink-0 font-mono text-xs text-dls-secondary">{props.skill.name}</span>
            ) : null}
            {sourceKindLabel ? (
              <span className="shrink-0 rounded border border-dls-border px-1 py-0 text-xs font-medium text-dls-secondary">{sourceKindLabel}</span>
            ) : null}
            {props.skill.managedByStudioSwitch ? (
              <Tooltip>
                <TooltipTrigger render={<span className="size-1.5 shrink-0 rounded-full bg-dls-accent" aria-label={t("skills.matrix_managed_badge")} />} />
                <TooltipContent side="bottom"><span>{t("skills.matrix_managed_badge")}</span></TooltipContent>
              </Tooltip>
            ) : null}
            {props.skill.readonly ? (
              <Tooltip>
                <TooltipTrigger render={<span className="size-1.5 shrink-0 rounded-full bg-dls-secondary" aria-label={t("skills.matrix_readonly_badge")} />} />
                <TooltipContent side="bottom"><span>{t("skills.matrix_readonly_badge")}</span></TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-dls-secondary">
            {description ? (
              <span className="min-w-0 flex-1 truncate" title={description}>{description}</span>
            ) : (
              <span className="min-w-0 flex-1 truncate font-mono opacity-70" title={pathSummary}>{pathSummary}</span>
            )}
            <span className="shrink-0 truncate text-dls-secondary/70 max-w-[40%]" title={pathSummary}>{sourceSummary}</span>
          </div>
        </div>
      </MenuRowButton>

      {STUDIO_SWITCH_SKILL_AGENT_OPTIONS.map((agent) => {
        const { state, tooltip } = getSkillCellState(props.skill, agent, props.busyKey);
        return (
          <div key={agent} className="border-l border-dls-border">
            <SkillMatrixCell
              state={state}
              agent={agent}
              tooltip={tooltip}
              onClick={() => {
                if (state === "native") return;
                if (state === "managed") props.onSkillAction(props.skill, agent, "disable");
                else if (state === "available") props.onSkillAction(props.skill, agent, "enable");
              }}
            />
          </div>
        );
      })}

      <div className="flex shrink-0 items-center justify-end gap-0.5 border-l border-dls-border pr-2 opacity-0 transition-opacity group-hover:opacity-100">
        {!props.skill.managedByStudioSwitch ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs"
                  type="button"
                  disabled={importBusy}
                  className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:cursor-default disabled:opacity-60"
                  onClick={(event) => { event.stopPropagation(); props.onSkillAction(props.skill, importAgent, "import"); }}
                  aria-label={t("skills.matrix_import_managed")}
                >
                  {importBusy ? <LoadingSpinner size="sm" /> : <Download className="size-3.5" />}
                </Button>
              }
            />
            <TooltipContent side="bottom"><span>{t("skills.matrix_import_managed")}</span></TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-xs"
                type="button"
                className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                onClick={(event) => { event.stopPropagation(); props.onSkillAction(props.skill, props.skill.agents[0] ?? "unknown", "open"); }}
                aria-label={t("skills.matrix_open_folder")}
              >
                <FolderOpen className="size-3.5" />
              </Button>
            }
          />
          <TooltipContent side="bottom"><span>{t("skills.matrix_open_folder")}</span></TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function SkillMatrixDrawer(props: {
  skill: AgentManagementSkill;
  busyKey: string | null;
  onClose: () => void;
  onSkillAction: (skill: AgentManagementSkill, agent: AgentManagementSkillAgent, action: "enable" | "disable" | "open" | "import") => void;
}) {
  const skill = props.skill;
  const title = skill.displayNameZh || skill.displayNameEn || skill.name;
  const description = skill.descriptionZh || skill.descriptionEn || skill.description || "";
  const sourceKind = skill.kind ?? skill.sources.find((source) => source.kind)?.kind ?? "skill";
  const sourceKindLabel = sourceKind === "runtime-skill" ? "Runtime" : sourceKind === "slash-command" ? "Slash" : sourceKind === "plugin" ? "Plugin" : null;
  const importAgent = skill.agents.find((agent) => STUDIO_SWITCH_SKILL_AGENT_OPTIONS.includes(agent)) ?? skill.sources.find((source) => STUDIO_SWITCH_SKILL_AGENT_OPTIONS.includes(source.agent))?.agent ?? "claude";
  const importBusy = props.busyKey === `${skill.path}:${importAgent}:import`;
  const copyPath = useCallback(async (path: string) => {
    try { await navigator.clipboard.writeText(path); } catch (_) { /* ignore */ }
  }, []);
  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-dls-border bg-dls-surface">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-dls-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-dls-text">{title}</span>
            {sourceKindLabel ? (
              <span className="shrink-0 rounded border border-dls-border px-1 py-0 text-xs font-medium text-dls-secondary">{sourceKindLabel}</span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-dls-secondary">{skill.name}</div>
        </div>
        <Button variant="ghost" size="icon-xs"
          type="button"
          onClick={props.onClose}
          className="shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          aria-label={t("common.close")}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-dls-text">
        {description ? (
          <section className="mb-4">
            <div className="mb-1 text-xs font-medium text-dls-secondary">{t("skills.matrix_description")}</div>
            <p className="whitespace-pre-wrap leading-relaxed">{description}</p>
          </section>
        ) : null}

        <section className="mb-4">
          <div className="mb-1.5 text-xs font-medium text-dls-secondary">{t("skills.matrix_agent_enablement")}</div>
          <div className="grid grid-cols-6 gap-1.5">
            {STUDIO_SWITCH_SKILL_AGENT_OPTIONS.map((agent) => {
              const { state, tooltip } = getSkillCellState(skill, agent, props.busyKey);
              return (
                <div key={agent} className="flex flex-col items-center gap-1 rounded-lg border border-dls-border bg-dls-surface-muted py-2">
                  <div className="size-4"><AgentSkillIcon agent={agent} /></div>
                  <SkillMatrixCell
                    state={state}
                    agent={agent}
                    tooltip={tooltip}
                    onClick={() => {
                      if (state === "managed") props.onSkillAction(skill, agent, "disable");
                      else if (state === "available") props.onSkillAction(skill, agent, "enable");
                    }}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-4">
          <div className="mb-1.5 text-xs font-medium text-dls-secondary">{t("skills.matrix_sources", { count: skill.sources.length })}</div>
          <ul className="space-y-1.5">
            {skill.sources.map((source, index) => (
              <li key={`${source.agent}:${source.path}:${index}`} className="rounded-lg border border-dls-border bg-dls-surface px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="flex size-3.5 items-center justify-center"><AgentSkillIcon agent={source.agent} /></span>
                  <span className="font-medium">{source.label}</span>
                  <span className="text-dls-secondary">·</span>
                  <span className="text-dls-secondary">{source.scope}</span>
                  {source.managedByStudioSwitch ? <StatusBadge className="ml-auto" size="tiny" tone="success">{t("skills.matrix_managed")}</StatusBadge> : null}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-dls-secondary" title={source.path}>{source.path}</span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void copyPath(source.path)}
                          aria-label={t("skills.matrix_copy_path")}
                        >
                          <Copy className="size-3" />
                        </Button>
                      }
                    />
                    <TooltipContent side="bottom"><span>{t("skills.matrix_copy_path")}</span></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => props.onSkillAction(skill, source.agent, "open")}
                          aria-label={t("skills.matrix_open_folder")}
                        >
                          <FolderOpen className="size-3" />
                        </Button>
                      }
                    />
                    <TooltipContent side="bottom"><span>{t("skills.matrix_open_folder")}</span></TooltipContent>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {!skill.managedByStudioSwitch ? (
          <EmptyStateBox className="text-left" size="compact">
            <div className="mb-1.5 font-medium text-dls-text">{t("skills.matrix_unmanaged")}</div>
            <p className="leading-relaxed">{t("skills.matrix_unmanaged_hint")}</p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={importBusy}
              onClick={() => props.onSkillAction(skill, importAgent, "import")}
              className="mt-2"
            >
              {importBusy ? <LoadingSpinner size="sm" /> : <Download className="size-3" />}
              <span>{t("skills.matrix_import_to_studio_switch")}</span>
            </Button>
          </EmptyStateBox>
        ) : null}
      </div>
    </aside>
  );
}

export function SkillMatrixPanel(props: {
  skills: AgentManagementSkill[];
  totalSkills: number;
  search: string;
  onSearchChange: (value: string) => void;
  busyKey: string | null;
  onSkillAction: (skill: AgentManagementSkill, agent: AgentManagementSkillAgent, action: "enable" | "disable" | "open" | "import") => void;
  columnFilter: AgentManagementSkillAgent[];
  onColumnFilterChange: (value: AgentManagementSkillAgent[]) => void;
  countsByAgent: Record<string, number>;
  selectedSkill: AgentManagementSkill | null;
  onSelectSkill: (skill: AgentManagementSkill | null) => void;
}) {
  const filtered = useMemo(() => {
    if (props.columnFilter.length === 0) return props.skills;
    return props.skills.filter((skill) => props.columnFilter.every((agent) => skill.agents.includes(agent)));
  }, [props.skills, props.columnFilter]);

  const handleHeaderToggle = useCallback((agent: AgentManagementSkillAgent, event: React.MouseEvent) => {
    const multi = event.shiftKey;
    const exists = props.columnFilter.includes(agent);
    if (multi) {
      props.onColumnFilterChange(exists ? props.columnFilter.filter((item) => item !== agent) : [...props.columnFilter, agent]);
    } else {
      if (exists && props.columnFilter.length === 1) props.onColumnFilterChange([]);
      else props.onColumnFilterChange([agent]);
    }
  }, [props.columnFilter, props.onColumnFilterChange]);

  return (
    <section className={cn("grid min-h-0 gap-3", props.selectedSkill && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-dls-border px-3 py-2">
          <InputGroup controlSize="sm" radius="lg" tone="surface" className="min-w-0 flex-1">
            <InputGroupAddon align="inline-start" inset="tight">
              <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={props.search}
              onChange={(event) => props.onSearchChange(event.currentTarget.value)}
              placeholder={t("skills.matrix_search_placeholder")}
              className="h-8 text-xs"
            />
          </InputGroup>
          {props.columnFilter.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => props.onColumnFilterChange([])}
            >
              <X data-icon="inline-start" className="size-3" />
              <span>{t("skills.matrix_clear_column_filters", { count: props.columnFilter.length })}</span>
            </Button>
          ) : null}
          <span className="text-xs tabular-nums text-dls-secondary">{t("skills.matrix_count", { visible: filtered.length, total: props.totalSkills })}</span>
        </div>

        <div
          className="grid shrink-0 items-stretch border-b border-dls-border bg-dls-surface-muted text-xs font-medium text-dls-secondary"
          style={SKILL_MATRIX_GRID_STYLE}
        >
          <div className="flex items-center gap-1.5 px-4 py-2">
            <FileText className="size-3.5" />
            <span>{t("skills.matrix_skill_source")}</span>
          </div>
          {STUDIO_SWITCH_SKILL_AGENT_OPTIONS.map((agent) => (
            <SkillMatrixColumnHeader
              key={agent}
              agent={agent}
              active={props.columnFilter.includes(agent)}
              count={props.countsByAgent[agent] ?? 0}
              onToggle={(event) => handleHeaderToggle(agent, event)}
            />
          ))}
          <div className="border-l border-dls-border" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map((skill) => (
              <SkillMatrixRow
                key={`${skill.path}/${skill.name}`}
                skill={skill}
                busyKey={props.busyKey}
                selected={props.selectedSkill?.path === skill.path && props.selectedSkill?.name === skill.name}
                onSkillAction={props.onSkillAction}
                onOpenDetail={(item) => props.onSelectSkill(item)}
              />
            ))
          ) : (
            <div className="px-4 py-12 text-center text-sm text-dls-secondary">
              <FileText className="mx-auto mb-2 size-8 opacity-40" />
              <div>{t("skills.matrix_empty")}</div>
              {props.search || props.columnFilter.length > 0 ? (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="mt-2 text-xs text-dls-accent hover:underline"
                  onClick={() => { props.onSearchChange(""); props.onColumnFilterChange([]); }}
                >
                  {t("skills.matrix_clear_filters")}
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-dls-border bg-dls-surface-muted px-3 py-1.5 text-xs text-dls-secondary">
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="native" size="legend" /><span>{t("skills.matrix_legend_native")}</span></span>
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="managed" size="legend" /><span>{t("skills.matrix_legend_managed")}</span></span>
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="available" size="legend" /><span>{t("skills.matrix_legend_available")}</span></span>
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="readonly" size="legend" /><span>{t("skills.matrix_legend_readonly")}</span></span>
          <span className="ml-auto">{t("skills.matrix_legend_hint")}</span>
        </div>
      </div>

      {props.selectedSkill ? (
        <div className="hidden min-h-0 overflow-hidden rounded-xl border border-dls-border bg-dls-surface lg:flex">
          <SkillMatrixDrawer
            skill={props.selectedSkill}
            busyKey={props.busyKey}
            onClose={() => props.onSelectSkill(null)}
            onSkillAction={props.onSkillAction}
          />
        </div>
      ) : null}
    </section>
  );
}
