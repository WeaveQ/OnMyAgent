/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, CircleHelp, ClipboardList, ListChecks, MessageCircle, Rocket, Target, Users } from "lucide-react";

import type { ComposerCollaborationMode } from "../../../../../app/types";
import { MenuRowButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "../../../../../components/ui/switch";
import { cn } from "@/lib/utils";
import { t } from "../../../../../i18n";

type CollaborationModeSelectProps = {
  value: ComposerCollaborationMode;
  onChange: (value: ComposerCollaborationMode) => void;
  disabled?: boolean;
  variant?: "office" | "legacy";
};

type CollaborationModeOption = {
  kind: NonNullable<ComposerCollaborationMode["kind"]>;
  label: string;
  description: string;
  tools: string;
  Icon: typeof Rocket;
};

const COLLABORATION_MODE_OPTIONS: CollaborationModeOption[] = [
  {
    kind: "craft",
    get label() { return t("composer.collaboration_craft"); },
    get description() { return t("composer.collaboration_craft_desc"); },
    get tools() { return t("composer.collaboration_craft_tools"); },
    Icon: Rocket,
  },
  {
    kind: "ask",
    get label() { return t("composer.collaboration_ask"); },
    get description() { return t("composer.collaboration_ask_desc"); },
    get tools() { return t("composer.collaboration_ask_tools"); },
    Icon: MessageCircle,
  },
  {
    kind: "plan",
    get label() { return t("composer.collaboration_plan"); },
    get description() { return t("composer.collaboration_plan_desc"); },
    get tools() { return t("composer.collaboration_plan_tools"); },
    Icon: ClipboardList,
  },
];

const LEGACY_COLLABORATION_MODE_OPTIONS = [
  {
    key: "planning",
    get label() { return t("composer.collaboration_planning"); },
    get description() { return t("composer.collaboration_planning_desc"); },
    Icon: ListChecks,
  },
  {
    key: "pursueGoal",
    get label() { return t("composer.collaboration_pursue_goal"); },
    get description() { return t("composer.collaboration_pursue_goal_desc"); },
    Icon: Target,
  },
] satisfies Array<{
  key: "planning" | "pursueGoal";
  label: string;
  description: string;
  Icon: typeof Rocket;
}>;

function selectedCollaborationKind(value: ComposerCollaborationMode): NonNullable<ComposerCollaborationMode["kind"]> {
  if (value.kind === "craft" || value.kind === "ask" || value.kind === "plan") return value.kind;
  if (value.planning) return "plan";
  return "craft";
}

function collaborationModeValue(kind: NonNullable<ComposerCollaborationMode["kind"]>): ComposerCollaborationMode {
  return {
    kind,
    planning: kind === "plan",
    pursueGoal: kind === "craft",
  };
}

export function CollaborationModeSelect(props: CollaborationModeSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const variant = props.variant ?? "legacy";
  const selectedKind = selectedCollaborationKind(props.value);
  const selectedOption =
    COLLABORATION_MODE_OPTIONS.find((option) => option.kind === selectedKind) ??
    COLLABORATION_MODE_OPTIONS[0];
  const enabledCount = LEGACY_COLLABORATION_MODE_OPTIONS.filter((option) => props.value[option.key]).length;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  if (variant === "legacy") {
    return (
      <div ref={rootRef} className="relative">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("max-w-40 shrink min-w-0 rounded-md px-2 disabled:cursor-not-allowed disabled:opacity-60",
            enabledCount > 0
              ? "bg-dls-hover text-dls-text hover:bg-dls-active"
              : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
          )}
          onClick={() => setOpen((value) => !value)}
          disabled={props.disabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={t("composer.collaboration_mode")}
        >
          <Users size={15} className="shrink-0" />
          <span className="min-w-0 truncate">{t("composer.collaboration_mode")}</span>
          <ChevronDown size={14} className="shrink-0" />
        </Button>

        {open ? (
          <div
            role="dialog"
            className="absolute bottom-full left-0 z-40 mb-2 w-[min(calc(100vw-2.5rem),320px)] overflow-hidden rounded-xl border border-dls-border bg-dls-surface p-1.5"
          >
            <div className="px-3 py-2 text-xs font-medium text-dls-text">
              {t("composer.collaboration_choose_mode")}
            </div>
            {LEGACY_COLLABORATION_MODE_OPTIONS.map((option) => {
              const Icon = option.Icon;
              const checked = props.value[option.key];
              return (
                <div
                  key={option.key}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-dls-secondary transition-colors hover:bg-dls-surface-muted/70"
                >
                  <Icon size={18} className="shrink-0 text-dls-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-dls-text">{option.label}</div>
                    <div className="mt-0.5 truncate text-xs text-dls-secondary">{option.description}</div>
                  </div>
                  <Switch
                    size="sm"
                    checked={checked}
                    onCheckedChange={(nextChecked) => {
                      props.onChange({
                        planning: props.value.planning,
                        pursueGoal: props.value.pursueGoal,
                        [option.key]: nextChecked,
                      });
                    }}
                    disabled={props.disabled}
                    aria-label={option.label}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-w-40 shrink min-w-0 rounded-md px-2 text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => setOpen((value) => !value)}
        disabled={props.disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        title={selectedOption.label}
      >
        <selectedOption.Icon size={15} className="shrink-0" />
        <span className="min-w-0 truncate">{selectedOption.label}</span>
        <ChevronDown size={14} className="shrink-0" />
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-2 w-36 overflow-hidden rounded-lg border border-dls-border bg-dls-surface p-1"
        >
          <TooltipProvider delay={120}>
            {COLLABORATION_MODE_OPTIONS.map((option) => {
              const Icon = option.Icon;
              const checked = selectedKind === option.kind;
              return (
                <MenuRowButton
                  key={option.kind}
                  type="button"
                  align="center"
                  className={cn(
                    "h-8 gap-2 rounded-md px-2 py-1.5",
                    checked && "bg-dls-hover text-dls-text",
                  )}
                  onClick={() => {
                    props.onChange(collaborationModeValue(option.kind));
                    setOpen(false);
                  }}
                  role="menuitemradio"
                  aria-checked={checked}
                >
                  <Icon size={15} className="shrink-0 text-dls-secondary" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-dls-text">
                    {option.label}
                  </span>
                  {checked ? <Check size={14} className="shrink-0 text-dls-text" /> : null}
                  <Tooltip>
                    <TooltipTrigger
                      render={<span />}
                      className="shrink-0 text-dls-secondary hover:text-dls-text"
                      onClick={(event) => event.stopPropagation()}
                      aria-label={t("composer.collaboration_mode_info", { mode: option.label })}
                    >
                      <CircleHelp size={13} />
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      align="start"
                      className="block w-52 rounded-md border border-dls-border bg-dls-surface px-2.5 py-2 text-left text-xs leading-5 text-dls-text"
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className="mt-0.5 text-dls-secondary">{option.description}</div>
                      <div className="mt-2 text-dls-secondary">{t("composer.collaboration_tools_builtin")}</div>
                      <div className="text-dls-text">{option.tools}</div>
                    </TooltipContent>
                  </Tooltip>
                </MenuRowButton>
              );
            })}
          </TooltipProvider>
        </div>
      ) : null}
    </div>
  );
}
