/** @jsxImportSource react */
/**
 * Composer + menu flyouts (files / modes / templates / skills / connectors).
 * Extracted from composer.tsx to shrink the host and keep menu UI presentational.
 */
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Dispatch, SetStateAction } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  MessageCircle,
  Paperclip,
  Pin,
  PinOff,
  Plug,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTile, MenuRowButton } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../../../../../i18n";
import type { McpDirectoryInfo } from "../../../../../app/constants";
import type { CloudImportedPluginFile } from "../../../../../app/cloud/import-state";
import type { McpServerEntry, SlashCommandOption } from "../../../../../app/types";
import { SkillGlyphIcon } from "../../../../design-system/skill-glyph-icon";
import {
  isOnMyAgentExtensionEnabled,
  setOnMyAgentExtensionEnabled,
} from "../../../shared";
import {
  type CollaborationModeOption,
  type ComposerPromptTemplate,
  type McpServerStatus,
  type ToolMenuSection,
  extensionIcon,
  extensionIconTileClassName,
  mcpServerDescription,
} from "./composer-helpers";
import { formatPluginObjectType, skillMenuDescription } from "./tool-menu-model";

type McpMenuItem = { entry: McpServerEntry; status: McpServerStatus };

export type ComposerToolMenuProps = {
  toolMenuSection: ToolMenuSection;
  setToolMenuSection: (section: ToolMenuSection) => void;
  attachmentsEnabled: boolean;
  canCaptureAppshot: boolean;
  openFilePicker: () => void;
  captureAppshot: () => void | Promise<void>;
  promptTemplates: ComposerPromptTemplate[];
  selectedPromptTemplateId: string | null;
  setSelectedPromptTemplateId: (id: string | null) => void;
  selectedPromptTemplate: ComposerPromptTemplate | null;
  applyPromptTemplate: (templateId: string, prompt: string) => void;
  collaborationVariant: string;
  modeOptions: CollaborationModeOption[];
  selectedModeKey: string | null;
  applyCollaborationModeSelection: (
    option: CollaborationModeOption,
    opts?: { keepMenuOpen?: boolean },
  ) => void;
  skillSearchQuery: string;
  setSkillSearchQuery: (q: string) => void;
  connectorSearchQuery: string;
  setConnectorSearchQuery: (q: string) => void;
  filteredSkillItems: SlashCommandOption[];
  filteredPluginSkillFiles: CloudImportedPluginFile[];
  filteredMcpItems: McpMenuItem[];
  filteredComposerExtensions: McpDirectoryInfo[];
  hasSkillMatches: boolean;
  hasSkills: boolean;
  hasConnectorMatches: boolean;
  hasConnectors: boolean;
  commandsLoaded: boolean;
  commandsLoading: boolean;
  skillsLoaded: boolean;
  skillsLoading: boolean;
  mcpLoaded: boolean;
  mcpLoading: boolean;
  mcpStatus: string | null;
  pinnedSkillIds: string[];
  handleTogglePinnedSkill: (command: SlashCommandOption) => void;
  applyCommandSelection: (command: SlashCommandOption) => void;
  applyPluginFileSelection: (file: CloudImportedPluginFile) => void;
  applyExtensionSelection: (ext: McpDirectoryInfo) => void;
  applyExtensionSuggestion: (ext: McpDirectoryInfo, prompt: string) => void;
  selectedComposerExtension: McpDirectoryInfo | null;
  setSelectedComposerExtension: (ext: McpDirectoryInfo | null) => void;
  openToolMenuSettings: () => void;
  openConnectorsConfigure: () => void;
  openCustomConnectorOrMarketplace: () => void;
  setToolMenuOpen: Dispatch<SetStateAction<boolean>>;
  setExtensionStateVersion: Dispatch<SetStateAction<number>>;
};

export function ComposerToolMenu(props: ComposerToolMenuProps) {
  const {
    toolMenuSection,
    setToolMenuSection,
    attachmentsEnabled,
    canCaptureAppshot,
    openFilePicker,
    captureAppshot,
    promptTemplates,
    selectedPromptTemplateId,
    setSelectedPromptTemplateId,
    selectedPromptTemplate,
    applyPromptTemplate,
    collaborationVariant,
    modeOptions,
    selectedModeKey,
    applyCollaborationModeSelection,
    skillSearchQuery,
    setSkillSearchQuery,
    connectorSearchQuery,
    setConnectorSearchQuery,
    filteredSkillItems,
    filteredPluginSkillFiles,
    filteredMcpItems,
    filteredComposerExtensions,
    hasSkillMatches,
    hasSkills,
    hasConnectorMatches,
    hasConnectors,
    commandsLoaded,
    commandsLoading,
    skillsLoaded,
    skillsLoading,
    mcpLoaded,
    mcpLoading,
    mcpStatus,
    pinnedSkillIds,
    handleTogglePinnedSkill,
    applyCommandSelection,
    applyPluginFileSelection,
    applyExtensionSelection,
    applyExtensionSuggestion,
    selectedComposerExtension,
    setSelectedComposerExtension,
    openToolMenuSettings,
    openConnectorsConfigure,
    openCustomConnectorOrMarketplace,
    setToolMenuOpen,
    setExtensionStateVersion,
  } = props;

  return (
<div className="absolute bottom-full left-0 z-40 mb-3 h-0 w-0">
  {/* Primary list — WorkBuddy-style short labels, no truncation at rest. */}
  <div
    className="absolute bottom-0 left-0 w-44 rounded-xl border border-dls-border bg-dls-surface-solid p-1.5"
    style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
  >
    <div className="grid gap-0.5">
      <MenuRowButton
        type="button"
        align="center"
        density="compact"
        active={toolMenuSection === "files"}
        // Match 2nd-column skill titles: primary text, not muted gray.
        className="justify-between gap-2 text-dls-text hover:text-dls-text"
        disabled={!attachmentsEnabled}
        onMouseEnter={() => setToolMenuSection("files")}
        onFocus={() => setToolMenuSection("files")}
        onClick={openFilePicker}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Paperclip className="size-3.5 shrink-0 text-dls-text" />
          <span className="truncate text-sm leading-5 text-dls-text">{t("composer.add_file")}</span>
        </span>
      </MenuRowButton>
      {canCaptureAppshot ? (
        <MenuRowButton
          type="button"
          align="center"
          density="compact"
          className="gap-2 text-dls-text hover:text-dls-text"
          disabled={!attachmentsEnabled}
          onClick={() => void captureAppshot()}
        >
          <Camera className="size-3.5 shrink-0 text-dls-text" />
          <span className="truncate text-sm leading-5 text-dls-text">{t("composer.capture_appshot")}</span>
        </MenuRowButton>
      ) : null}
      <div
        className="my-1 h-px bg-dls-border/80"
        role="separator"
      />
      {([
        ["modes", t("composer.collaboration_mode"), Sparkles] as const,
        ...(promptTemplates.length > 0
          ? ([["templates", t("composer.prompt_templates_short"), ClipboardList]] as const)
          : []),
        ["skills", t("dashboard.skills"), SkillGlyphIcon] as const,
        ["mcps", t("composer.connectors_label"), Plug] as const,
      ]).map(([section, label, Icon]) => (
        <MenuRowButton
          key={section}
          type="button"
          align="center"
          density="compact"
          active={toolMenuSection === section}
          className="justify-between gap-2 text-dls-text hover:text-dls-text"
          onMouseEnter={() => {
            setToolMenuSection(section);
            // WorkBuddy-style: open first template category so the 3rd flyout appears.
            if (section === "templates" && promptTemplates[0]) {
              setSelectedPromptTemplateId(promptTemplates[0].id);
            }
          }}
          onFocus={() => {
            setToolMenuSection(section);
            if (section === "templates" && promptTemplates[0]) {
              setSelectedPromptTemplateId(promptTemplates[0].id);
            }
          }}
          onClick={() => {
            setToolMenuSection(section);
            if (section === "templates" && promptTemplates[0]) {
              setSelectedPromptTemplateId(promptTemplates[0].id);
            }
          }}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon className="size-3.5 shrink-0 text-dls-text" />
            <span className="truncate text-sm leading-5 text-dls-text">{label}</span>
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-dls-text/50" />
        </MenuRowButton>
      ))}
    </div>
  </div>
  {toolMenuSection === "files" ? null : (
    <div
      className={cn(
        // Shared 2nd-column width for modes / prompts / skills / connectors.
        "absolute bottom-0 left-[calc(11rem-1px)] flex w-[min(calc(100vw-13.5rem),17.5rem)] max-w-[17.5rem] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid",
      )}
      style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
    >
      {toolMenuSection === "templates" ? (
        <div className="flex min-h-9 shrink-0 items-center border-b border-dls-border px-3 py-1.5 text-sm font-medium text-dls-text">
          {t("composer.prompt_templates")}
        </div>
      ) : toolMenuSection === "skills" ? (
        <div className="space-y-1.5 px-3 pt-2 pb-1">
          {/* Match connectors panel: title + quiet configure, then search */}
          <div className="flex min-h-7 items-center justify-between gap-3">
            <div className="text-sm font-medium text-dls-text">
              {t("dashboard.skills")}
              <span className="tabular-nums font-medium text-dls-secondary">
                {" "}
                ({filteredSkillItems.length + filteredPluginSkillFiles.length})
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 gap-1 text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-text"
              onClick={() => {
                setToolMenuOpen(false);
                openToolMenuSettings();
              }}
            >
              <Settings className="size-3.5" />
              {t("composer.configure")}
            </Button>
          </div>
          <InputGroup
            controlSize="sm"
            radius="lg"
            tone="surfaceMuted"
            className="border-dls-border/50"
          >
            <InputGroupAddon align="inline-start" inset="compact">
              <Search aria-hidden="true" className="size-3.5 text-dls-secondary" />
            </InputGroupAddon>
            <InputGroupInput
              value={skillSearchQuery}
              onChange={(event) => setSkillSearchQuery(event.currentTarget.value)}
              placeholder={t("composer.search_skills")}
              aria-label={t("composer.search_skills")}
              className="text-sm text-dls-text placeholder:text-dls-secondary/70"
            />
          </InputGroup>
        </div>
      ) : toolMenuSection === "mcps" ? (
        <div className="space-y-1.5 px-3 pt-2 pb-1">
          {/* WorkBuddy-like: title + count, configure, then search */}
          <div className="flex min-h-7 items-center justify-between gap-3">
            <div className="text-sm font-medium text-dls-text">
              {t("composer.connectors_label")}
              <span className="tabular-nums font-medium text-dls-secondary">
                {" "}
                ({filteredMcpItems.length + filteredComposerExtensions.length})
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 gap-1 text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-text"
              onClick={openConnectorsConfigure}
              title={t("composer.configure")}
              aria-label={t("composer.configure")}
            >
              <Settings className="size-3.5" />
              {t("composer.configure")}
            </Button>
          </div>
          <InputGroup
            controlSize="sm"
            radius="lg"
            tone="surfaceMuted"
            className="border-dls-border/50"
          >
            <InputGroupAddon align="inline-start" inset="compact">
              <Search aria-hidden="true" className="size-3.5 text-dls-secondary" />
            </InputGroupAddon>
            <InputGroupInput
              value={connectorSearchQuery}
              onChange={(event) => setConnectorSearchQuery(event.currentTarget.value)}
              placeholder={t("composer.search_connectors")}
              aria-label={t("composer.search_connectors")}
              className="text-sm text-dls-text placeholder:text-dls-secondary/70"
            />
          </InputGroup>
        </div>
      ) : toolMenuSection === "modes" && collaborationVariant !== "office" ? (
        <div className="flex min-h-10 items-center border-b border-dls-border px-3 py-2 text-sm font-medium text-dls-text">
          {t("composer.collaboration_choose_mode")}
        </div>
      ) : null}
      <div
        className={cn(
          "overflow-x-hidden overflow-y-auto px-1.5 pb-1.5",
          // Skills/connectors already pad under search — avoid double gap.
          toolMenuSection === "skills" || toolMenuSection === "mcps"
            ? "pt-0"
            : "pt-1.5",
          // Templates list is short (≤3) — keep panel compact so the 3rd flyout fits.
          toolMenuSection === "templates" ? "max-h-48" : "max-h-56",
        )}
      >
        {toolMenuSection === "templates" ? (
          <div className="grid gap-0.5">
            {promptTemplates.map((template) => {
              const Icon = template.icon;
              return (
                <MenuRowButton
                  key={template.id}
                  type="button"
                  align="center"
                  density="compact"
                  active={selectedPromptTemplate?.id === template.id}
                  className="justify-between gap-2"
                  onMouseEnter={() => setSelectedPromptTemplateId(template.id)}
                  onFocus={() => setSelectedPromptTemplateId(template.id)}
                  onClick={() => setSelectedPromptTemplateId(template.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="size-3.5 shrink-0 text-dls-secondary" />
                    <span className="truncate text-sm text-dls-text">
                      {template.label}
                    </span>
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" />
                </MenuRowButton>
              );
            })}
          </div>
        ) : null}
        {toolMenuSection === "modes" ? (
          collaborationVariant === "office" ? (
            <div className="space-y-3 px-1 py-1">
              <p className="whitespace-nowrap text-sm leading-5 text-dls-secondary">
                {(
                  modeOptions.find((option) => option.key === (selectedModeKey ?? "craft")) ??
                  modeOptions[0]
                )?.description}
              </p>
              <div className="h-px bg-dls-border" />
              <div className="grid gap-3">
                {(
                  [
                    {
                      key: "plan" as const,
                      label: t("composer.collaboration_plan_toggle"),
                    },
                    {
                      key: "ask" as const,
                      label: t("composer.collaboration_ask_toggle"),
                    },
                  ] as const
                ).map((item) => {
                  const checked = selectedModeKey === item.key;
                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-sm text-dls-text">{item.label}</span>
                      <Switch
                        size="sm"
                        checked={checked}
                        onCheckedChange={(next) => {
                          if (next) {
                            applyCollaborationModeSelection(
                              modeOptions.find((option) => option.key === item.key)!,
                              { keepMenuOpen: true },
                            );
                            return;
                          }
                          applyCollaborationModeSelection(
                            modeOptions.find((option) => option.key === "craft")!,
                            { keepMenuOpen: true },
                          );
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="grid gap-0.5">
              {modeOptions.map((option) => {
                const checked = selectedModeKey === option.key;
                const Icon = option.Icon;
                return (
                  <MenuRowButton
                    key={option.key}
                    type="button"
                    align="center"
                    density="compact"
                    active={checked}
                    className="gap-3"
                    onClick={() => applyCollaborationModeSelection(option)}
                    role="menuitemradio"
                    aria-checked={checked}
                  >
                    <Icon className="size-3.5 shrink-0 text-dls-secondary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-dls-text">
                        {option.label}
                      </div>
                      <div className="truncate text-xs text-dls-secondary">
                        {option.description}
                      </div>
                    </div>
                    {checked ? (
                      <Check className="size-3.5 shrink-0 text-dls-text" />
                    ) : null}
                  </MenuRowButton>
                );
              })}
            </div>
          )
        ) : null}
        {toolMenuSection === "skills" ? (
          hasSkillMatches ? (
            <TooltipProvider delay={280}>
              <div className="grid min-w-0 gap-0.5">
                {filteredSkillItems.map((command) => {
                  const description = skillMenuDescription(command.description);
                  const isPinned =
                    pinnedSkillIds.includes(command.id) ||
                    pinnedSkillIds.includes(`skill:${command.name}`) ||
                    pinnedSkillIds.includes(`cmd:${command.name}`);
                  const rowBody = (
                    <div className="group/skill flex min-w-0 items-stretch gap-0.5 rounded-xl hover:bg-dls-surface-muted/70">
                      <MenuRowButton
                        type="button"
                        align="center"
                        className="min-w-0 flex-1 gap-2 overflow-hidden bg-transparent hover:bg-transparent"
                        onClick={() => applyCommandSelection(command)}
                      >
                        <div className="min-w-0 flex-1 overflow-hidden text-left">
                          <div className="truncate text-sm font-medium text-dls-text">
                            {command.name}
                          </div>
                          {description ? (
                            <div className="truncate text-xs text-dls-secondary">
                              {description}
                            </div>
                          ) : null}
                        </div>
                      </MenuRowButton>
                      <button
                        type="button"
                        className={cn(
                          "inline-flex size-8 shrink-0 !w-8 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                          isPinned
                            ? "text-dls-accent hover:bg-dls-surface-muted"
                            : "text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-text",
                        )}
                        title={
                          isPinned
                            ? t("composer.unpin_skill")
                            : t("composer.pin_skill")
                        }
                        aria-label={
                          isPinned
                            ? t("composer.unpin_skill")
                            : t("composer.pin_skill")
                        }
                        aria-pressed={isPinned}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleTogglePinnedSkill(command);
                        }}
                      >
                        {isPinned ? (
                          <PinOff className="size-3.5" aria-hidden />
                        ) : (
                          <Pin className="size-3.5" aria-hidden />
                        )}
                      </button>
                    </div>
                  );
                  if (!description) {
                    return <div key={command.id}>{rowBody}</div>;
                  }
                  return (
                    <Tooltip key={command.id}>
                      <TooltipTrigger
                        render={<div className="min-w-0" />}
                        className="min-w-0"
                      >
                        {rowBody}
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        className="max-w-[18rem] whitespace-normal text-left leading-5"
                      >
                        {description}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {filteredPluginSkillFiles.map((file) => (
                  <MenuRowButton
                    key={`${file.configObjectId}:${file.path}`}
                    type="button"
                    align="center"
                    className="w-full min-w-0 max-w-full gap-2 overflow-hidden"
                    onClick={() => applyPluginFileSelection(file)}
                  >
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-sm font-medium text-dls-text">
                          {file.title}
                        </div>
                        <StatusBadge size="tiny" tone="neutral" shape="soft" className="shrink-0">
                          {formatPluginObjectType(file.objectType)}
                        </StatusBadge>
                      </div>
                    </div>
                  </MenuRowButton>
                ))}
              </div>
            </TooltipProvider>
          ) : (
            <div className="px-3 py-2 text-xs text-dls-secondary">
              {(!skillsLoaded && skillsLoading) || (!commandsLoaded && commandsLoading)
                ? t("composer.loading_commands")
                : hasSkills
                  ? t("composer.no_matching_skills")
                  : t("context_panel.no_skills")}
            </div>
          )
        ) : null}
        {toolMenuSection === "mcps" ? (
          hasConnectorMatches ? (
            <TooltipProvider delay={280}>
              <div className="grid min-w-0 gap-0.5">
                {filteredComposerExtensions.length > 0 ? (
                  <>
                    <div className="px-2 pb-0.5 pt-1 text-2xs font-medium uppercase tracking-wide text-dls-secondary">
                      {t("composer.connectors_group_builtin")}
                    </div>
                    {filteredComposerExtensions.map((entry) => {
                      const description = entry.description?.trim() ?? "";
                      const enabled = isOnMyAgentExtensionEnabled(entry);
                      const hasPrompts = Boolean(entry.suggestedPrompts?.length);
                      const rowKey = entry.id ?? entry.serverName ?? entry.name;
                      const rowBody = (
                        <div
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-dls-hover",
                            selectedComposerExtension === entry && "bg-dls-hover",
                          )}
                          onMouseEnter={() =>
                            setSelectedComposerExtension(hasPrompts ? entry : null)
                          }
                        >
                          <IconTile
                            size="sm"
                            shape="lg"
                            tone="surface"
                            border
                            className={extensionIconTileClassName}
                          >
                            {extensionIcon(entry, 16)}
                          </IconTile>
                          <button
                            type="button"
                            className="min-w-0 flex-1 overflow-hidden text-left"
                            onClick={() => {
                              if (hasPrompts) {
                                setSelectedComposerExtension(entry);
                                return;
                              }
                              if (!enabled) {
                                setOnMyAgentExtensionEnabled(entry, true);
                                setExtensionStateVersion((v) => v + 1);
                              }
                              applyExtensionSelection(entry);
                            }}
                          >
                            <div className="truncate text-sm font-medium text-dls-text">
                              {entry.name}
                            </div>
                            {description ? (
                              <div className="truncate text-xs text-dls-secondary">
                                {description}
                              </div>
                            ) : null}
                          </button>
                          <Switch
                            size="sm"
                            className="shrink-0"
                            checked={enabled}
                            onCheckedChange={(next) => {
                              setOnMyAgentExtensionEnabled(entry, next);
                              setExtensionStateVersion((v) => v + 1);
                            }}
                            aria-label={entry.name}
                          />
                        </div>
                      );
                      if (!description) {
                        return <div key={rowKey}>{rowBody}</div>;
                      }
                      return (
                        <Tooltip key={rowKey}>
                          <TooltipTrigger
                            render={<div className="min-w-0" />}
                            className="min-w-0"
                          >
                            {rowBody}
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className="max-w-[18rem] whitespace-normal text-left leading-5"
                          >
                            {description}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </>
                ) : null}
                {filteredMcpItems.length > 0 ? (
                  <>
                    <div className="px-2 pb-0.5 pt-2 text-2xs font-medium uppercase tracking-wide text-dls-secondary">
                      {t("composer.connectors_group_mcp")}
                    </div>
                    {filteredMcpItems.map(({ entry, status }) => {
                      const description = mcpServerDescription(entry);
                      const ready = status === "connected";
                      const rowBody = (
                        <div className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-dls-hover">
                          <IconTile
                            size="sm"
                            shape="lg"
                            tone="surface"
                            border
                            className={extensionIconTileClassName}
                          >
                            <Plug
                              className="size-3.5 text-neutral-900"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </IconTile>
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-sm font-medium text-dls-text">
                              {entry.name}
                            </div>
                            {description ? (
                              <div className="truncate text-xs text-dls-secondary">
                                {description}
                              </div>
                            ) : null}
                          </div>
                          <Switch
                            size="sm"
                            className="shrink-0"
                            checked={ready}
                            onCheckedChange={() => {
                              // MCP enable/disable lives in opencode config — open the editor.
                              openCustomConnectorOrMarketplace();
                            }}
                            aria-label={entry.name}
                          />
                        </div>
                      );
                      if (!description) {
                        return <div key={entry.name}>{rowBody}</div>;
                      }
                      return (
                        <Tooltip key={entry.name}>
                          <TooltipTrigger
                            render={<div className="min-w-0" />}
                            className="min-w-0"
                          >
                            {rowBody}
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className="max-w-[18rem] whitespace-normal text-left leading-5"
                          >
                            {description}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </>
                ) : null}
              </div>
            </TooltipProvider>
          ) : (
            <div className="px-3 py-2 text-xs text-dls-secondary">
              {!mcpLoaded && mcpLoading
                ? t("composer.loading_commands")
                : hasConnectors
                  ? t("composer.no_matching_connectors")
                  : (mcpStatus ?? t("context_panel.no_mcp"))}
            </div>
          )
        ) : null}
      </div>
    </div>
  )}
  {toolMenuSection === "templates" && selectedPromptTemplate ? (
    <div
      className="absolute bottom-0 left-[calc(11rem+17.5rem-2px)] flex w-[min(calc(100vw-30rem),16rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid"
      style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
    >
      <div className="flex min-h-9 shrink-0 items-center border-b border-dls-border px-3 py-1.5 text-sm font-medium text-dls-text">
        <span className="truncate">{selectedPromptTemplate.label}</span>
      </div>
      <div className="max-h-48 overflow-x-hidden overflow-y-auto p-1.5">
        <div className="grid gap-0.5">
          {selectedPromptTemplate.prompts.map((prompt) => (
            <MenuRowButton
              key={prompt}
              type="button"
              align="start"
              density="compact"
              className="gap-2"
              onClick={() => applyPromptTemplate(selectedPromptTemplate.id, prompt)}
            >
              <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-dls-secondary" />
              <span className="line-clamp-2 text-sm leading-5 text-dls-text">{prompt}</span>
            </MenuRowButton>
          ))}
        </div>
      </div>
    </div>
  ) : null}
  {toolMenuSection === "mcps" && selectedComposerExtension?.suggestedPrompts?.length ? (
    <div
      className="absolute bottom-0 left-[calc(11rem+17.5rem-2px)] flex w-[min(calc(100vw-30rem),16rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid"
      style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
    >
      <div className="flex min-h-9 shrink-0 items-center border-b border-dls-border px-3 py-1.5 text-sm font-medium text-dls-text">
        <span className="truncate">{selectedComposerExtension.name}</span>
      </div>
      <div className="max-h-48 overflow-x-hidden overflow-y-auto p-1.5">
        <div className="grid gap-0.5">
          {selectedComposerExtension.suggestedPrompts.map((prompt) => (
            <MenuRowButton
              key={prompt}
              type="button"
              align="start"
              density="compact"
              className="gap-2"
              onClick={() => applyExtensionSuggestion(selectedComposerExtension, prompt)}
            >
              <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-dls-secondary" />
              <span className="line-clamp-2 text-sm leading-5 text-dls-text">{prompt}</span>
            </MenuRowButton>
          ))}
        </div>
      </div>
    </div>
  ) : null}
</div>

  
  );
}
