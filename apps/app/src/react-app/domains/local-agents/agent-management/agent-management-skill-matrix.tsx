import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { Copy, Download, FileText, FolderOpen, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconTile, MatrixButton, MenuRowButton, NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { EmptyStateBox } from "@/components/ui/notice-box";
import { Skeleton } from "@/components/ui/skeleton";
import { CountBadge, StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import type { AgentManagementSkill, AgentManagementSkillAgent } from "../../../../app/lib/desktop";
import {
  skillAgentLabel,
  STUDIO_SWITCH_SKILL_AGENT_OPTIONS,
} from "./agent-management-skill-model";
import type { SkillInventoryScope } from "./skill-inventory-scope";
import { AgentBrandIcon, agentBrandIconTileClass } from "../agent-brand-icon";

type SkillCellState = "native" | "managed" | "available" | "readonly" | "busy" | "unavailable";

// Skill name | agent enable columns | actions (download + folder)
// Fixed tracks must match header + row exactly (no extra padding on either side).
const SKILL_MATRIX_AGENT_COL = "44px";
const SKILL_MATRIX_ACTION_COL = "52px";
/** Hairline rules — avoid stacked full-opacity borders looking "thick". */
const SKILL_MATRIX_RULE = "border-dls-border/25";

function skillMatrixGridStyle(agentColCount: number) {
  const n = Math.max(1, agentColCount);
  return {
    gridTemplateColumns: `minmax(12rem,1fr) repeat(${n}, ${SKILL_MATRIX_AGENT_COL}) ${SKILL_MATRIX_ACTION_COL}`,
  } as const;
}

const SKILL_MATRIX_SKELETON_ROWS = 8;
const SKILL_MATRIX_SKELETON_TITLE_WIDTHS = [
  "w-3/5",
  "w-1/2",
  "w-2/3",
  "w-2/5",
  "w-3/4",
  "w-1/2",
  "w-3/5",
  "w-2/5",
] as const;
const SKILL_MATRIX_SKELETON_META_WIDTHS = [
  "w-1/3",
  "w-1/4",
  "w-2/5",
  "w-1/4",
  "w-1/3",
  "w-1/5",
  "w-2/5",
  "w-1/4",
] as const;

/** Placeholder rows that mirror SkillMatrixRow tracks while the snapshot loads. */
function SkillMatrixSkeletonRows(props: { agentColCount: number }) {
  const gridStyle = skillMatrixGridStyle(props.agentColCount);
  const agentSlots = Math.max(1, props.agentColCount);
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t("skills.matrix_loading")}</span>
      {Array.from({ length: SKILL_MATRIX_SKELETON_ROWS }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className={cn("grid min-h-12 items-stretch border-b", SKILL_MATRIX_RULE)}
          style={gridStyle}
        >
          <div className="flex min-w-0 items-center gap-2.5 self-center px-3 py-2">
            <div className="flex h-8 w-[3.75rem] shrink-0 items-center">
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="-ml-1.5 size-6 rounded-md opacity-70" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton
                className={cn(
                  "h-3.5 max-w-full rounded-lg",
                  SKILL_MATRIX_SKELETON_TITLE_WIDTHS[rowIndex % SKILL_MATRIX_SKELETON_TITLE_WIDTHS.length],
                )}
              />
              <Skeleton
                className={cn(
                  "h-3 max-w-full rounded-md",
                  SKILL_MATRIX_SKELETON_META_WIDTHS[rowIndex % SKILL_MATRIX_SKELETON_META_WIDTHS.length],
                )}
              />
            </div>
          </div>
          {Array.from({ length: agentSlots }, (_, colIndex) => (
            <SkillMatrixAgentTrack key={colIndex} leadRule={colIndex === 0}>
              <Skeleton className="size-5 rounded-md" />
            </SkillMatrixAgentTrack>
          ))}
          <div className={cn("flex items-center justify-center gap-0.5 border-l px-1", SKILL_MATRIX_RULE)}>
            <Skeleton className="size-5 rounded-md" />
            <Skeleton className="size-5 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Shared track for header icons and row install cells.
 * Only the first agent column draws a left rule (skill | matrix), so vertical lines
 * stay a single hairline and columns do not double-border against each other.
 */
function SkillMatrixAgentTrack(props: {
  children: ReactNode;
  className?: string;
  /** When true, draw the skill-name | agents separator (first agent col only). */
  leadRule?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full min-w-0 items-center justify-center self-stretch",
        props.leadRule && `border-l ${SKILL_MATRIX_RULE}`,
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

const EMPTY_UNAVAILABLE_AGENTS: ReadonlySet<string> = new Set();

function SkillStateGlyph(props: {
  state: Exclude<SkillCellState, "busy">;
  size?: "cell" | "legend";
}) {
  const sizeClass = props.size === "legend" ? "size-4 text-2xs" : "size-4 text-xs";
  if (props.state === "native") {
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-full font-semibold leading-none text-white",
          sizeClass,
          // Theme accent blue — not online/green status (product selection marker).
          "bg-dls-accent",
        )}
      >
        ✓
      </span>
    );
  }
  if (props.state === "managed") {
    // Soft filled check — same family as native, lighter surface (no corner marker).
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-full font-semibold leading-none text-dls-accent",
          sizeClass,
          "bg-dls-accent/15 ring-1 ring-dls-accent/40",
        )}
      >
        ✓
      </span>
    );
  }
  if (props.state === "available") {
    // Always-visible soft + ; hover lifts contrast without flashing a white fill.
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-full font-medium leading-none",
          sizeClass,
          "border border-dashed border-dls-border/80 bg-transparent text-dls-secondary/80",
          props.size !== "legend" &&
            "transition-colors group-hover/cell:border-dls-border-strong group-hover/cell:bg-dls-surface-muted group-hover/cell:text-dls-text",
        )}
      >
        +
      </span>
    );
  }
  if (props.state === "unavailable") {
    // Agent not installed — quiet disabled mark, not a dashed +
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-full font-medium leading-none text-dls-secondary/45",
          sizeClass,
          "border border-dashed border-dls-border/50 bg-transparent",
        )}
        aria-hidden
      >
        –
      </span>
    );
  }
  return <span className="h-0.5 w-2.5 rounded-full bg-dls-border" />;
}

function SkillMatrixCell(props: {
  state: SkillCellState;
  agent: AgentManagementSkillAgent;
  tooltip: string;
  onClick?: () => void;
}) {
  const interactive =
    props.state === "native" ||
    props.state === "managed" ||
    props.state === "available";
  let glyph: React.ReactNode;
  if (props.state === "busy") {
    glyph = <LoadingSpinner size="sm" className="text-dls-secondary" />;
  } else if (props.state === "native") {
    glyph = <SkillStateGlyph state="native" />;
  } else if (props.state === "managed") {
    glyph = <SkillStateGlyph state="managed" />;
  } else if (props.state === "available") {
    glyph = <SkillStateGlyph state="available" />;
  } else if (props.state === "unavailable") {
    glyph = <SkillStateGlyph state="unavailable" />;
  } else {
    glyph = <SkillStateGlyph state="readonly" />;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        delay={280}
        render={
          <MatrixButton
            type="button"
            disabled={!interactive}
            onClick={interactive ? props.onClick : undefined}
            interactive={interactive}
            className={cn(
              // Quiet cell hover — avoid bright wash behind empty + glyphs.
              interactive && props.state === "available" && "hover:bg-transparent",
              interactive && props.state !== "available" && "hover:bg-dls-hover",
              props.state === "native" && "hover:brightness-95",
              props.state === "unavailable" && "opacity-50",
            )}
            aria-label={props.tooltip}
          >
            {glyph}
          </MatrixButton>
        }
      />
      <TooltipContent side="bottom">
        <span>{props.tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function SkillMatrixColumnHeader(props: {
  agent: AgentManagementSkillAgent;
  active: boolean;
  count: number;
  unavailable?: boolean;
  /** Draw skill-name | agents separator (first agent column only). */
  leadRule?: boolean;
  onToggle: (event: React.MouseEvent) => void;
}) {
  const label = skillAgentLabel(props.agent);
  const unavailable = Boolean(props.unavailable);
  return (
    <SkillMatrixAgentTrack leadRule={props.leadRule}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MatrixButton
              type="button"
              kind="header"
              onClick={unavailable ? undefined : props.onToggle}
              active={props.active && !unavailable}
              interactive={!unavailable}
              disabled={unavailable}
              className={cn(
                unavailable
                  ? "cursor-not-allowed opacity-40"
                  : props.active
                    ? "bg-dls-surface-muted/80 text-dls-text"
                    : "hover:bg-dls-hover/50",
              )}
              aria-pressed={props.active && !unavailable}
              aria-disabled={unavailable || undefined}
              aria-label={
                unavailable
                  ? t("skills.matrix_column_unavailable", { label })
                  : t("skills.matrix_column_label", {
                      label,
                      count: props.count,
                      filtered: props.active ? t("skills.matrix_filtered_suffix") : "",
                    })
              }
            >
              {/* Same plate as local-agent list (muted / dark white), smaller xs tile. */}
              <AgentBrandIcon id={props.agent} provider={props.agent} size="xs" alt={label} />
              <span className="tabular-nums leading-none opacity-80">{props.count}</span>
            </MatrixButton>
          }
        />
        <TooltipContent side="bottom">
          <span>
            {unavailable
              ? t("skills.matrix_column_unavailable", { label })
              : t("skills.matrix_column_tooltip", { label })}
          </span>
        </TooltipContent>
      </Tooltip>
    </SkillMatrixAgentTrack>
  );
}

function getSkillCellState(
  skill: AgentManagementSkill,
  agent: AgentManagementSkillAgent,
  busyKey: string | null,
  agentUnavailable = false,
): { state: SkillCellState; tooltip: string } {
  const label = skillAgentLabel(agent);
  if (agentUnavailable) {
    return {
      state: "unavailable",
      tooltip: t("skills.matrix_tooltip_agent_missing", { label }),
    };
  }
  const enabled = skill.agents.includes(agent);
  const ownsSource = skill.sources.some((source) => source.agent === agent && source.path === skill.path && !source.managedByStudioSwitch);
  const sourceKind = skill.kind ?? skill.sources.find((source) => source.kind)?.kind ?? "skill";
  const canSync = sourceKind === "skill" && skill.sources.some((source) => source.kind !== "runtime-skill" && source.kind !== "slash-command");
  const busy = busyKey === `${skill.path}:${agent}`;
  if (busy) return { state: "busy", tooltip: t("skills.matrix_tooltip_busy", { label }) };
  if (enabled && ownsSource) return { state: "native", tooltip: t("skills.matrix_tooltip_native", { label }) };
  if (enabled) return { state: "managed", tooltip: t("skills.matrix_tooltip_managed", { label }) };
  if (!canSync) return { state: "readonly", tooltip: t("skills.matrix_tooltip_readonly", { label }) };
  return { state: "available", tooltip: t("skills.matrix_tooltip_available", { label }) };
}

function SkillAgentCluster(props: {
  skill: AgentManagementSkill;
  /** Visible matrix columns — cluster must match these, not a hard-coded agent list. */
  matrixAgents: ReadonlyArray<AgentManagementSkillAgent>;
}) {
  // Order by matrix columns so the stack mirrors the accent checkmarks the user sees.
  // (Old code filtered only STUDIO_SWITCH_SKILL_AGENT_OPTIONS and dropped grok/mimo/workbuddy/…)
  const enabledAgents = props.matrixAgents.filter((agent) =>
    props.skill.agents.includes(agent),
  );
  // Always at most 3 slots: 2 brand icons + optional +N plate (e.g. 5 enabled → 2 icons + "+3").
  const showOverflow = enabledAgents.length > 2;
  const visibleAgents = enabledAgents.slice(0, showOverflow ? 2 : enabledAgents.length);
  const overflow = showOverflow ? enabledAgents.length - 2 : 0;
  const label =
    enabledAgents.length > 0
      ? enabledAgents.map((agent) => skillAgentLabel(agent)).join(" / ")
      : t("skills.matrix_no_enabled_agents");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            // Match single-icon rows below: fixed height, left-aligned stack.
            className="flex h-8 w-[3.75rem] shrink-0 items-center justify-start"
            aria-label={label}
          >
            {visibleAgents.length > 0 ? (
              <div className="flex items-center">
                {visibleAgents.map((agent, index) => (
                  <AgentBrandIcon
                    key={agent}
                    id={agent}
                    provider={agent}
                    size="xs"
                    alt={skillAgentLabel(agent)}
                    className={cn(
                      "relative",
                      index > 0 && "-ml-1.5",
                    )}
                    // Stacked cluster: denser xs plate, soft overlap.
                  />
                ))}
                {overflow > 0 ? (
                  <span
                    className={cn(
                      agentBrandIconTileClass,
                      "relative -ml-1.5 size-6 rounded-md text-2xs font-semibold tabular-nums leading-none text-dls-secondary dark:text-neutral-700",
                    )}
                    aria-hidden
                  >
                    +{overflow}
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="size-6 rounded-md border border-dashed border-dls-border bg-dls-surface-muted dark:bg-white/80" />
            )}
          </div>
        }
      />
      <TooltipContent side="bottom">
        <span>{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function SkillMatrixRow(props: {
  skill: AgentManagementSkill;
  busyKey: string | null;
  selected: boolean;
  matrixAgents: ReadonlyArray<AgentManagementSkillAgent>;
  unavailableAgents?: ReadonlySet<string>;
  onSkillAction: (skill: AgentManagementSkill, agent: AgentManagementSkillAgent, action: "enable" | "disable" | "open" | "import") => void;
  onOpenDetail: (skill: AgentManagementSkill) => void;
}) {
  const sourceLabels = Array.from(new Set(props.skill.sources.map((source) => source.label)));
  const sourceSummary =
    sourceLabels.length > 0 ? sourceLabels.join(" · ") : props.skill.scopeLabel;
  const pathSummary = props.skill.sources[0]?.path ?? props.skill.path;
  const title =
    props.skill.displayNameZh || props.skill.displayNameEn || props.skill.name;
  const sourceKind =
    props.skill.kind ?? props.skill.sources.find((source) => source.kind)?.kind ?? "skill";
  const sourceKindLabel =
    sourceKind === "runtime-skill"
      ? t("agent_manager.skill.kind_runtime")
      : sourceKind === "slash-command"
        ? t("agent_manager.skill.kind_slash")
        : sourceKind === "plugin"
          ? t("agent_manager.skill.kind_plugin")
          : null;
  const importAgent =
    props.skill.agents.find((agent) => props.matrixAgents.includes(agent)) ??
    props.skill.sources.find((source) =>
      props.matrixAgents.includes(source.agent as AgentManagementSkillAgent),
    )?.agent ??
    props.matrixAgents[0] ??
    "claude";
  const importBusy = props.busyKey === `${props.skill.path}:${importAgent}:import`;
  const gridStyle = skillMatrixGridStyle(props.matrixAgents.length);
  const unavailable = props.unavailableAgents ?? EMPTY_UNAVAILABLE_AGENTS;
  return (
    <div
      className={cn(
        "group grid min-h-12 items-stretch border-b text-xs transition-colors",
        SKILL_MATRIX_RULE,
        props.selected ? "bg-dls-list-selected" : "hover:bg-dls-hover/50",
      )}
      style={gridStyle}
    >
      <MenuRowButton
        type="button"
        onClick={() => props.onOpenDetail(props.skill)}
        align="center"
        className="min-w-0 gap-2.5 self-center px-3 py-2"
      >
        <SkillAgentCluster skill={props.skill} matrixAgents={props.matrixAgents} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium leading-5 text-dls-text">
              {title}
            </span>
            {props.skill.managedByStudioSwitch ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-dls-accent"
                      aria-label={t("skills.matrix_managed_badge")}
                    />
                  }
                />
                <TooltipContent side="bottom">
                  <span>{t("skills.matrix_managed_badge")}</span>
                </TooltipContent>
              </Tooltip>
            ) : null}
            {props.skill.readonly ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-dls-secondary"
                      aria-label={t("skills.matrix_readonly_badge")}
                    />
                  }
                />
                <TooltipContent side="bottom">
                  <span>{t("skills.matrix_readonly_badge")}</span>
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          {/* Meta only — long description lives in the detail drawer */}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            {sourceSummary ? (
              <StatusBadge
                tone="surface"
                shape="soft"
                size="tiny"
                className="max-w-[min(100%,14rem)] truncate font-normal"
                title={pathSummary}
              >
                {sourceSummary}
              </StatusBadge>
            ) : null}
            {sourceKindLabel ? (
              <StatusBadge tone="neutral" shape="soft" size="tiny" className="font-normal">
                {sourceKindLabel}
              </StatusBadge>
            ) : null}
          </div>
        </div>
      </MenuRowButton>

      {props.matrixAgents.map((agent, index) => {
        const { state, tooltip } = getSkillCellState(
          props.skill,
          agent,
          props.busyKey,
          unavailable.has(agent),
        );
        return (
          <SkillMatrixAgentTrack key={agent} leadRule={index === 0}>
            <SkillMatrixCell
              state={state}
              agent={agent}
              tooltip={tooltip}
              onClick={() => {
                if (state === "native" || state === "unavailable") return;
                if (state === "managed") props.onSkillAction(props.skill, agent, "disable");
                else if (state === "available") props.onSkillAction(props.skill, agent, "enable");
              }}
            />
          </SkillMatrixAgentTrack>
        );
      })}

      <div
        className={cn(
          "flex shrink-0 items-center justify-end gap-0.5 self-center border-l pr-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
          SKILL_MATRIX_RULE,
        )}
      >
        {!props.skill.managedByStudioSwitch ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  disabled={importBusy}
                  className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:cursor-default disabled:opacity-60"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSkillAction(props.skill, importAgent, "import");
                  }}
                  aria-label={t("skills.matrix_import_managed")}
                >
                  {importBusy ? <LoadingSpinner size="sm" /> : <Download className="size-3.5" />}
                </Button>
              }
            />
            <TooltipContent side="bottom">
              <span>{t("skills.matrix_import_managed")}</span>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onSkillAction(
                    props.skill,
                    props.skill.agents[0] ?? "unknown",
                    "open",
                  );
                }}
                aria-label={t("skills.matrix_open_folder")}
              >
                <FolderOpen className="size-3.5" />
              </Button>
            }
          />
          <TooltipContent side="bottom">
            <span>{t("skills.matrix_open_folder")}</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function SkillMatrixDrawer(props: {
  skill: AgentManagementSkill;
  busyKey: string | null;
  matrixAgents: ReadonlyArray<AgentManagementSkillAgent>;
  unavailableAgents?: ReadonlySet<string>;
  onClose: () => void;
  onSkillAction: (skill: AgentManagementSkill, agent: AgentManagementSkillAgent, action: "enable" | "disable" | "open" | "import") => void;
}) {
  const skill = props.skill;
  const title = skill.displayNameZh || skill.displayNameEn || skill.name;
  const description = skill.descriptionZh || skill.descriptionEn || skill.description || "";
  const sourceKind = skill.kind ?? skill.sources.find((source) => source.kind)?.kind ?? "skill";
  const sourceKindLabel = sourceKind === "runtime-skill" ? t("agent_manager.skill.kind_runtime") : sourceKind === "slash-command" ? t("agent_manager.skill.kind_slash") : sourceKind === "plugin" ? t("agent_manager.skill.kind_plugin") : null;
  const importAgent =
    skill.agents.find((agent) => props.matrixAgents.includes(agent)) ??
    skill.sources.find((source) =>
      props.matrixAgents.includes(source.agent as AgentManagementSkillAgent),
    )?.agent ??
    props.matrixAgents[0] ??
    "claude";
  const importBusy = props.busyKey === `${skill.path}:${importAgent}:import`;
  const unavailable = props.unavailableAgents ?? EMPTY_UNAVAILABLE_AGENTS;
  const copyPath = useCallback(async (path: string) => {
    try { await navigator.clipboard.writeText(path); } catch (_) { /* ignore */ }
  }, []);
  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-dls-surface">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-dls-border/30 px-4 py-3">
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
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
            {props.matrixAgents.map((agent) => {
              const { state, tooltip } = getSkillCellState(
                skill,
                agent,
                props.busyKey,
                unavailable.has(agent),
              );
              return (
                <div key={agent} className="flex flex-col items-center gap-1 rounded-lg border border-dls-border bg-dls-surface-muted py-2">
                  <AgentBrandIcon id={agent} provider={agent} size="xs" alt={skillAgentLabel(agent)} />
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
                  <AgentBrandIcon id={source.agent} provider={source.agent} size="xs" alt={source.label} />
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
  /** Fleet-ready skill columns (product keys + custom with skill dirs). */
  matrixAgents?: ReadonlyArray<AgentManagementSkillAgent>;
  /** Agents not installed / not in fleet — show – cells. */
  unavailableAgents?: ReadonlySet<string>;
  inventoryScope?: SkillInventoryScope;
  onInventoryScopeChange?: (scope: SkillInventoryScope) => void;
  scopeCounts?: { fleet: number; all: number; shared: number };
  /** First-load without cache: show skeleton instead of false empty state. */
  loading?: boolean;
}) {
  const matrixAgents = props.matrixAgents?.length
    ? props.matrixAgents
    : STUDIO_SWITCH_SKILL_AGENT_OPTIONS;
  const unavailable = props.unavailableAgents ?? EMPTY_UNAVAILABLE_AGENTS;
  const inventoryScope = props.inventoryScope ?? "all";
  const loading = Boolean(props.loading);
  const gridStyle = skillMatrixGridStyle(matrixAgents.length);

  const filtered = useMemo(() => {
    if (props.columnFilter.length === 0) return props.skills;
    return props.skills.filter((skill) => props.columnFilter.every((agent) => skill.agents.includes(agent)));
  }, [props.skills, props.columnFilter]);

  /** Scope/search/column reduced the list; distinct from a truly empty snapshot. */
  const hasActiveFilters =
    Boolean(props.search.trim()) ||
    props.columnFilter.length > 0 ||
    inventoryScope !== "all";
  const isEmptyInventory =
    props.totalSkills === 0 &&
    !props.search.trim() &&
    props.columnFilter.length === 0;

  const handleHeaderToggle = useCallback((agent: AgentManagementSkillAgent, event: React.MouseEvent) => {
    if (loading || unavailable.has(agent)) return;
    const multi = event.shiftKey;
    const exists = props.columnFilter.includes(agent);
    if (multi) {
      props.onColumnFilterChange(exists ? props.columnFilter.filter((item) => item !== agent) : [...props.columnFilter, agent]);
    } else {
      if (exists && props.columnFilter.length === 1) props.onColumnFilterChange([]);
      else props.onColumnFilterChange([agent]);
    }
  }, [loading, props.columnFilter, props.onColumnFilterChange, unavailable]);

  return (
    <section
      className={cn(
        "grid h-full min-h-0 flex-1 gap-0",
        props.selectedSkill && "lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]",
      )}
      aria-busy={loading || undefined}
    >
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border/50 bg-dls-surface",
          // When drawer is open, drop right edge so the shared seam is a single hairline on the drawer.
          props.selectedSkill && "lg:rounded-r-none lg:border-r-0",
        )}
      >
        {/* Search + inventory scope stay fixed above the matrix grid. */}
        <div className={cn("flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2", SKILL_MATRIX_RULE)}>
          <InputGroup controlSize="sm" radius="lg" tone="surface" className="min-w-0 flex-1">
            <InputGroupAddon align="inline-start" inset="tight">
              <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={props.search}
              onChange={(event) => props.onSearchChange(event.currentTarget.value)}
              placeholder={t("skills.matrix_search_placeholder")}
              className="h-8 text-xs"
              disabled={loading}
            />
          </InputGroup>
          {props.onInventoryScopeChange ? (
            <SegmentedTabGroup className="shrink-0">
              {(
                [
                  ["fleet", t("skills.matrix_scope_fleet"), props.scopeCounts?.fleet],
                  ["all", t("skills.matrix_scope_all"), props.scopeCounts?.all],
                  ["shared", t("skills.matrix_scope_shared"), props.scopeCounts?.shared],
                ] as const
              ).map(([scope, label, count]) => (
                <NavTabButton
                  key={scope}
                  type="button"
                  size="filter"
                  active={inventoryScope === scope}
                  disabled={loading}
                  onClick={() => props.onInventoryScopeChange?.(scope)}
                  className="gap-1 px-2 text-xs"
                >
                  <span>{label}</span>
                  {!loading && typeof count === "number" ? (
                    <span className="tabular-nums opacity-70">{count}</span>
                  ) : null}
                </NavTabButton>
              ))}
            </SegmentedTabGroup>
          ) : null}
          {props.columnFilter.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={loading}
              onClick={() => props.onColumnFilterChange([])}
            >
              <X data-icon="inline-start" className="size-3" />
              <span>{t("skills.matrix_clear_column_filters", { count: props.columnFilter.length })}</span>
            </Button>
          ) : null}
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-dls-secondary">
              <LoadingSpinner size="sm" />
              <span>{t("skills.matrix_loading")}</span>
            </span>
          ) : (
            <span className="text-xs tabular-nums text-dls-secondary">
              {t("skills.matrix_count", { visible: filtered.length, total: props.totalSkills })}
            </span>
          )}
        </div>

        {/*
          Header + rows share one scrollport so agent install columns always match the
          column icons above (separate header + body scroll was offset by the scrollbar).
        */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          <div
            className={cn(
              "sticky top-0 z-10 grid items-stretch border-b bg-dls-surface-muted/95 text-xs font-medium text-dls-secondary backdrop-blur-sm",
              SKILL_MATRIX_RULE,
            )}
            style={gridStyle}
          >
            <div className="flex items-center gap-1.5 self-center px-3 py-2">
              <FileText className="size-3.5" />
              <span>{t("skills.matrix_skill_source")}</span>
            </div>
            {matrixAgents.map((agent, index) => (
              <SkillMatrixColumnHeader
                key={agent}
                agent={agent}
                active={props.columnFilter.includes(agent)}
                count={loading ? 0 : (props.countsByAgent[agent] ?? 0)}
                unavailable={unavailable.has(agent)}
                leadRule={index === 0}
                onToggle={(event) => handleHeaderToggle(agent, event)}
              />
            ))}
            <div aria-hidden="true" className={cn("border-l", SKILL_MATRIX_RULE)} />
          </div>

          {loading && filtered.length === 0 ? (
            <SkillMatrixSkeletonRows agentColCount={matrixAgents.length} />
          ) : filtered.length > 0 ? (
            filtered.map((skill) => (
              <SkillMatrixRow
                key={`${skill.path}/${skill.name}`}
                skill={skill}
                busyKey={props.busyKey}
                selected={props.selectedSkill?.path === skill.path && props.selectedSkill?.name === skill.name}
                matrixAgents={matrixAgents}
                unavailableAgents={unavailable}
                onSkillAction={props.onSkillAction}
                onOpenDetail={(item) => props.onSelectSkill(item)}
              />
            ))
          ) : (
            <div className="px-4 py-12 text-center text-sm text-dls-secondary">
              <FileText className="mx-auto mb-2 size-8 opacity-40" />
              <div>
                {isEmptyInventory
                  ? t("skills.matrix_empty_inventory")
                  : t("skills.matrix_empty")}
              </div>
              {!isEmptyInventory && hasActiveFilters ? (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="mt-2 text-xs text-dls-accent hover:underline"
                  onClick={() => {
                    props.onSearchChange("");
                    props.onColumnFilterChange([]);
                    props.onInventoryScopeChange?.("all");
                  }}
                >
                  {t("skills.matrix_clear_filters")}
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <div className={cn("flex shrink-0 flex-wrap items-center gap-3 border-t bg-dls-surface-muted/70 px-3 py-1.5 text-xs text-dls-secondary", SKILL_MATRIX_RULE)}>
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="native" size="legend" /><span>{t("skills.matrix_legend_native")}</span></span>
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="managed" size="legend" /><span>{t("skills.matrix_legend_managed")}</span></span>
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="available" size="legend" /><span>{t("skills.matrix_legend_available")}</span></span>
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="unavailable" size="legend" /><span>{t("skills.matrix_legend_unavailable")}</span></span>
          <span className="inline-flex items-center gap-1"><SkillStateGlyph state="readonly" size="legend" /><span>{t("skills.matrix_legend_readonly")}</span></span>
          <span className="ml-auto">{t("skills.matrix_legend_hint")}</span>
        </div>
      </div>

      {props.selectedSkill ? (
        <div
          // Matrix drops its right border when open; one left hairline is the shared seam.
          className="hidden h-full min-h-0 overflow-hidden rounded-xl rounded-l-none border border-dls-border/40 bg-dls-surface lg:flex"
        >
          <SkillMatrixDrawer
            skill={props.selectedSkill}
            busyKey={props.busyKey}
            matrixAgents={matrixAgents}
            unavailableAgents={unavailable}
            onClose={() => props.onSelectSkill(null)}
            onSkillAction={props.onSkillAction}
          />
        </div>
      ) : null}
    </section>
  );
}
