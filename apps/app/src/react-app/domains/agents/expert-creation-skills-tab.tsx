/** @jsxImportSource react */
import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  NavTabButton,
  SegmentedTabGroup,
} from "@/components/ui/action-row";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  MARKETPLACE_CARD_GRID_COMPACT,
  SkillMarketplaceCard,
} from "@/components/ui/skill-marketplace-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmModal } from "../../design-system/modals/confirm-modal";
import { SKILLS_EMPTY_STATE_ASSET } from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import type { AgentSkillItem } from "./agent-registry";
import {
  expertCreationSkillKey,
  filterExpertCreationSkills,
  isExpertCreationSkillSelected,
  toggleExpertCreationSkill,
} from "./expert-creation-skill-picker-model";
import { IconCircle } from "./expert-creation-view-primitives";

function localSkillLabel(skill: AgentSkillItem): string {
  return skill.displayNameEn?.trim() || skill.name;
}
function localSkillDescription(skill: AgentSkillItem): string {
  return (
    skill.descriptionEn?.trim() ||
    skill.description?.trim() ||
    skill.descriptionZh?.trim() ||
    t("agents.expert_creation_no_skills_desc")
  );
}

type ExpertCreationSkillPickerTab = "mine" | "market";

function SkillPickerPopover(props: {
  skills: AgentSkillItem[];
  marketplaceSkills: AgentSkillItem[];
  selectedIds: string[];
  disabled?: boolean;
  triggerVariant?: "ghost" | "secondary";
  triggerClassName?: string;
  installingSkillId?: string | null;
  onToggle: (skill: AgentSkillItem) => void;
  onInstall: (skill: AgentSkillItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpertCreationSkillPickerTab>("mine");
  const [query, setQuery] = useState("");
  const sourceSkills = activeTab === "mine" ? props.skills : props.marketplaceSkills;
  const visibleSkills = useMemo(() => {
    return filterExpertCreationSkills(sourceSkills, query);
  }, [query, sourceSkills]);
  const installedSkillKeys = useMemo(
    () => new Set(props.skills.map((skill) => expertCreationSkillKey(skill))),
    [props.skills],
  );
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setActiveTab("mine");
      setQuery("");
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant={props.triggerVariant ?? "ghost"}
            size="sm"
            disabled={props.disabled}
            aria-label={t("agents.expert_creation_add_skill")}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn("justify-self-end gap-1.5", props.triggerClassName)}
          >
            <Plus data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_add_skill")}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-1.5"
      >
        <SegmentedTabGroup
          aria-label={t("agents.expert_creation_skill_picker_title")}
          className="w-full"
        >
          <NavTabButton
            type="button"
            size="tab"
            shape="tab"
            active={activeTab === "mine"}
            onClick={() => setActiveTab("mine")}
            className="min-w-0 flex-1 px-2"
          >
            {t("agents.expert_creation_skill_picker_my_skills")}
          </NavTabButton>
          <NavTabButton
            type="button"
            size="tab"
            shape="tab"
            active={activeTab === "market"}
            onClick={() => setActiveTab("market")}
            className="min-w-0 flex-1 px-2"
          >
            {t("agents.expert_creation_skill_picker_market")}
          </NavTabButton>
        </SegmentedTabGroup>
        <div className="relative p-1.5">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-dls-secondary"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("agents.search_skills")}
            aria-label={t("agents.search_skills")}
            variant="dls"
            className="pl-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {visibleSkills.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-dls-secondary">
              {t("agents.expert_creation_no_matching_skills")}
            </div>
          ) : (
            <div className="grid gap-0.5">
              {visibleSkills.map((skill) => {
                const skillKey = expertCreationSkillKey(skill);
                const selected = isExpertCreationSkillSelected(
                  skill,
                  props.selectedIds,
                  props.skills,
                );
                const installed = installedSkillKeys.has(skillKey);
                const installing = props.installingSkillId === skillKey;
                const handleSkillClick = () => {
                  if (activeTab === "market" && !installed) {
                    props.onInstall(skill);
                    return;
                  }
                  props.onToggle(skill);
                };
                return (
                  <div
                    key={skillKey}
                    className={cn(
                      "flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-dls-hover",
                      selected && "bg-dls-hover",
                    )}
                  >
                    {installing ? (
                      <span className="mt-0.5">
                        <LoadingSpinner size="sm" />
                        <span className="sr-only">
                          {t("agents.expert_creation_installing_skill")}
                        </span>
                      </span>
                    ) : (
                      <Checkbox
                        checked={selected}
                        onCheckedChange={handleSkillClick}
                        aria-label={localSkillLabel(skill)}
                        className="mt-0.5"
                      />
                    )}
                    <button
                      type="button"
                      disabled={installing}
                      className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30"
                      aria-pressed={selected}
                      onClick={handleSkillClick}
                    >
                      <span className="block truncate text-sm font-medium text-dls-text">
                        {localSkillLabel(skill)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-dls-secondary">
                        {localSkillDescription(skill)}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SkillsEmptyIllustration() {
  return (
    <EmptyStateIllustration
      src={SKILLS_EMPTY_STATE_ASSET}
      size="compact"
      className="mb-0 h-28 w-[9.5rem] max-w-full bg-dls-secondary/80"
    />
  );
}

function SkillImportDialog(props: {
  open: boolean;
  importing: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const importFiles = (files: File[]) => {
    if (files.length === 0) return;
    props.onImport(files);
    props.onOpenChange(false);
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl gap-4 rounded-xl bg-dls-surface p-6 text-dls-text sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("skills_marketplace.import_title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("skills_marketplace.import_drop")}</DialogDescription>
        </DialogHeader>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".md,.zip"
          multiple
          onChange={(event) => {
            importFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          disabled={props.importing}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            importFiles(Array.from(event.dataTransfer.files));
          }}
          className={cn(
            "flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-dls-border bg-dls-background text-center transition-colors mac:titlebar-no-drag",
            dragActive ? "border-dls-accent bg-dls-hover" : "hover:border-dls-border hover:bg-dls-hover",
            props.importing && "cursor-wait opacity-70",
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-dls-surface text-dls-secondary">
            {props.importing ? <LoadingSpinner size="default" /> : <Upload className="size-4" />}
          </span>
          <span className="text-sm text-dls-text">{t("skills_marketplace.import_drop")}</span>
        </button>
        <div className="space-y-2 text-xs leading-5 text-dls-secondary">
          <div className="font-medium text-dls-text">{t("skills_marketplace.import_requirements_title")}</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("skills_marketplace.import_requirement_skill_md")}</li>
            <li>{t("skills_marketplace.import_requirement_frontmatter")}</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SkillsPanel(props: {
  skills: AgentSkillItem[];
  marketplaceSkills: AgentSkillItem[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onInstallMarketplaceSkill: (skill: AgentSkillItem) => void;
  installingSkillId?: string | null;
  onImport: (files: File[]) => void;
  importing: boolean;
  loading: boolean;
  loadError: boolean;
  onRetryLoad: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const selectedSkills = props.skills.filter((skill) => props.selectedIds.includes(skill.id));

  const toggleSkill = (skill: AgentSkillItem) => {
    props.onSelectedIdsChange(
      toggleExpertCreationSkill(props.selectedIds, skill, props.skills),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mt-1 text-sm text-dls-secondary">{t("agents.expert_creation_skills_desc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SkillPickerPopover
            skills={props.skills}
            marketplaceSkills={props.marketplaceSkills}
            selectedIds={props.selectedIds}
            disabled={props.loading}
            installingSkillId={props.installingSkillId}
            onToggle={toggleSkill}
            onInstall={props.onInstallMarketplaceSkill}
          />
          <Button type="button" size="sm" variant="ghost" disabled={props.importing} onClick={() => setImportOpen(true)}>
            <Upload data-icon="inline-start" className="size-3.5" />
            {props.importing ? t("agents.expert_creation_importing") : t("agents.expert_creation_import_skill")}
          </Button>
        </div>
      </div>
      {props.loading && selectedSkills.length === 0 ? (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-xl bg-dls-surface px-6 text-center">
          <LoadingSpinner size="default" />
          <p className="mt-4 text-sm text-dls-secondary">{t("agents.expert_creation_loading_skills")}</p>
        </div>
      ) : props.loadError && selectedSkills.length === 0 ? (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-xl bg-dls-surface px-6 text-center">
          <NoticeBox role="alert" tone="error" size="content" className="max-w-md">
            {t("agents.expert_creation_load_skills_failed")}
          </NoticeBox>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={props.onRetryLoad}>
              {t("agents.expert_creation_retry")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.importing} onClick={() => setImportOpen(true)}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {props.importing ? t("agents.expert_creation_importing") : t("agents.expert_creation_import_skill")}
            </Button>
          </div>
        </div>
      ) : selectedSkills.length > 0 ? (
        <div className={MARKETPLACE_CARD_GRID_COMPACT}>
          {selectedSkills.map((skill) => {
            return (
              <SkillMarketplaceCard
                key={skill.id}
                skill={{
                  id: skill.id,
                  displayName: localSkillLabel(skill),
                  packageName: skill.name,
                  description: localSkillDescription(skill),
                  chips: skill.category && skill.category !== "installed"
                    ? [skill.category]
                    : [],
                }}
                ariaLabel={localSkillLabel(skill)}
                action={(
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => toggleSkill(skill)}
                    aria-label={t("agents.expert_creation_remove_skill")}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                )}
              />
            );
          })}
        </div>
      ) : (
        <Empty
          variant="ghost"
          className="min-h-[calc(100dvh-12rem)] rounded-xl bg-dls-surface px-6"
        >
          <EmptyHeader className="max-w-lg gap-4">
            <SkillsEmptyIllustration />
            <EmptyTitle className="text-base font-semibold">
              {t("agents.expert_creation_no_skills")}
            </EmptyTitle>
            <EmptyDescription className="max-w-lg leading-relaxed">
              {t("agents.expert_creation_no_skills_desc")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <SkillImportDialog
        open={importOpen}
        importing={props.importing}
        onOpenChange={setImportOpen}
        onImport={props.onImport}
      />
    </div>
  );
}
