/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import {
  installBuiltinSkillPackage,
  listLocalSkills,
  openDesktopPath,
  uninstallSkill,
} from "@/app/lib/desktop";
import type { LocalSkillCard } from "@/app/lib/desktop";
import type { OnMyAgentServerClient } from "@/app/lib/onmyagent-server";
import { isDesktopRuntime } from "@/app/utils";
import { FilterChip } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { CountBadge, StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  SKILL_MARKETPLACE_CATEGORIES,
} from "./categories";
import { BUILTIN_MARKETPLACE_SKILLS } from "./data";
import type { SkillMarketplaceEntry } from "./types";

/** Align with expert marketplace grid density. */
const SKILL_CARD_GRID =
  "grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

const OPC_AGGREGATED_CATEGORY_IDS = new Set([
  "developer",
  "deploy", // legacy id still present on some inferred skill records
  "productivity",
  "office",
]);

/** "developer" tab absorbs legacy "deploy" category id after the merge. */
function skillMatchesCategory(skill: SkillMarketplaceEntry, categoryId: string): boolean {
  if (categoryId === "all") return true;
  if (skill.categoryId === categoryId || skill.categoryIds.includes(categoryId)) return true;
  if (categoryId === "developer") {
    return skill.categoryId === "deploy" || skill.categoryIds.includes("deploy");
  }
  if (
    categoryId === "opc" &&
    (
      OPC_AGGREGATED_CATEGORY_IDS.has(skill.categoryId) ||
      skill.categoryIds.some((id) => OPC_AGGREGATED_CATEGORY_IDS.has(id))
    )
  ) {
    return true;
  }
  return false;
}

/** Max visible chips on outer card; each label truncated for single-line row. */
const SKILL_CARD_CHIP_MAX = 3;
const SKILL_CARD_CHIP_MAX_CHARS = 8;

function skillFallbackInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "S";
}

/** Localized short category name (not bilingual searchLabel). */
function skillCategoryDisplayLabel(categoryId: string): string {
  // Legacy "deploy" skills show under merged "开发部署".
  const resolvedId = categoryId === "deploy" ? "developer" : categoryId;
  const category = SKILL_MARKETPLACE_CATEGORIES.find((item) => item.id === resolvedId);
  if (!category || category.id === "all") return "";
  return t(category.labelKey);
}

function truncateSkillChip(label: string): string {
  const value = label.trim();
  if (!value) return "";
  if (value.length <= SKILL_CARD_CHIP_MAX_CHARS) return value;
  return `${value.slice(0, SKILL_CARD_CHIP_MAX_CHARS)}…`;
}

/**
 * Outer-card chips: localized categories + tags, max 3, short labels.
 * Avoid searchLabel bilingual strings like "内容创作 content creation".
 */
function skillCardChips(skill: SkillMarketplaceEntry): string[] {
  const categoryChips = skill.categoryIds
    .map(skillCategoryDisplayLabel)
    .filter(Boolean);
  return Array.from(new Set([...categoryChips, ...skill.tags].filter(Boolean)))
    .slice(0, SKILL_CARD_CHIP_MAX)
    .map(truncateSkillChip)
    .filter(Boolean);
}

/** Bottom-aligned chip row so all cards share one baseline (mt-auto + fixed min height). */
function SkillCardChipRow(props: { chips: string[] }) {
  return (
    <div className="mt-auto flex min-h-5 min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden pt-3">
      {props.chips.map((chip) => (
        <StatusBadge
          key={chip}
          tone="surface"
          shape="soft"
          size="tiny"
          className="max-w-[5.5rem] shrink-0 truncate"
          title={chip}
        >
          {chip}
        </StatusBadge>
      ))}
    </div>
  );
}

function SkillIcon(props: { skill: SkillMarketplaceEntry }) {
  if (props.skill.iconUrl) {
    return (
      <img
        src={props.skill.iconUrl}
        alt=""
        className="size-9 shrink-0 rounded-md object-cover"
      />
    );
  }
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-dls-surface-muted text-sm font-semibold text-dls-secondary">
      {skillFallbackInitial(props.skill.displayName)}
    </span>
  );
}

function isOnmyagentSkillPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.includes("/.onmyagent/skills/") || normalized.includes("/onmyagent/skills/");
}

function skillDisplayName(skill: LocalSkillCard): string {
  return skill.displayNameZh || skill.displayNameEn || skill.name;
}

function skillDescription(skill: LocalSkillCard): string {
  return skill.descriptionZh || skill.descriptionEn || skill.description || skill.trigger || "";
}

const builtinMarketplaceSkillByName = new Map(
  BUILTIN_MARKETPLACE_SKILLS.map((skill) => [skill.skillName, skill]),
);

function marketplaceSkillForLocalSkill(skill: LocalSkillCard): SkillMarketplaceEntry | null {
  return builtinMarketplaceSkillByName.get(skill.name) ?? null;
}

function yamlScalar(markdown: string, key: string): string {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const line = frontmatter
    .split(/\r?\n/)
    .find((item) => item.trimStart().startsWith(`${key}:`));
  if (!line) return "";
  return line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

async function readSkillMarkdown(file: File): Promise<{
  name: string;
  description?: string;
  content: string;
}> {
  const content = file.name.toLowerCase().endsWith(".zip")
    ? await readSkillMarkdownFromZip(file)
    : await file.text();
  const name = yamlScalar(content, "name");
  if (!name) {
    throw new Error(t("skills_marketplace.import_missing_name"));
  }
  return {
    name,
    description: yamlScalar(content, "description") || undefined,
    content,
  };
}

function findZipEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function inflateRawZipEntry(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  return new TextDecoder().decode(inflated);
}

async function decodeZipEntry(bytes: Uint8Array, method: number): Promise<string> {
  if (method === 0) return new TextDecoder().decode(bytes);
  if (method === 8) return inflateRawZipEntry(bytes);
  throw new Error(t("skills_marketplace.import_zip_method_unsupported"));
}

async function readSkillMarkdownFromZip(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findZipEndOfCentralDirectory(bytes);
  if (endOffset < 0) throw new Error(t("skills_marketplace.import_zip_invalid"));

  const entryCount = view.getUint16(endOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(t("skills_marketplace.import_zip_invalid"));
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const entryName = new TextDecoder().decode(bytes.slice(fileNameStart, fileNameEnd));
    const normalizedEntryName = entryName.toLowerCase();
    if (normalizedEntryName === "skill.md" || normalizedEntryName.endsWith("/skill.md")) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error(t("skills_marketplace.import_zip_invalid"));
      }
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      return decodeZipEntry(bytes.slice(dataStart, dataEnd), method);
    }
    offset = fileNameEnd + extraLength + commentLength;
  }
  throw new Error(t("skills_marketplace.import_no_skill_md"));
}

function findSkillMarkdownFile(files: File[]): File | null {
  const candidates = files.filter((file) => {
    const normalizedName = file.name.toLowerCase();
    return normalizedName.endsWith(".md") || normalizedName.endsWith(".zip");
  });
  return candidates.find((file) => file.name.toLowerCase() === "skill.md") ??
    candidates.find((file) => file.webkitRelativePath.toLowerCase().endsWith("/skill.md")) ??
    candidates[0] ??
    null;
}

function hasWebkitGetAsEntry(
  item: DataTransferItem,
): item is DataTransferItem & { webkitGetAsEntry: () => FileSystemEntry | null } {
  return "webkitGetAsEntry" in item && typeof item.webkitGetAsEntry === "function";
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile && "file" in entry && typeof entry.file === "function";
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory && "createReader" in entry && typeof entry.createReader === "function";
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File[]> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve([file]),
      (error) => reject(error),
    );
  });
}

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function readEntryFiles(entry: FileSystemEntry): Promise<File[]> {
  if (isFileEntry(entry)) return readEntryFile(entry);
  if (!isDirectoryEntry(entry)) return [];
  const reader = entry.createReader();
  const files: File[] = [];
  let batch = await readDirectoryBatch(reader);
  while (batch.length > 0) {
    const nested = await Promise.all(batch.map((item) => readEntryFiles(item)));
    files.push(...nested.flat());
    batch = await readDirectoryBatch(reader);
  }
  return files;
}

async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => hasWebkitGetAsEntry(item) ? item.webkitGetAsEntry() : null)
    .filter((entry) => entry !== null);
  if (entries.length === 0) return Array.from(dataTransfer.files);
  const nested = await Promise.all(entries.map((entry) => readEntryFiles(entry)));
  return nested.flat();
}

function SkillCard(props: {
  skill: SkillMarketplaceEntry;
  installed: boolean;
  installing: boolean;
  onInstall: (skill: SkillMarketplaceEntry) => void;
  onOpen: (skill: SkillMarketplaceEntry) => void;
}) {
  const chips = skillCardChips(props.skill);
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        // Match ExpertCard: taller tile, soft surface, no permanent border.
        "group flex h-full min-h-36 cursor-pointer flex-col rounded-2xl border border-transparent bg-dls-surface px-4 py-3.5 text-left transition-colors",
        "hover:border-dls-border hover:bg-dls-hover",
        "focus-visible:border-dls-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
        "mac:titlebar-no-drag",
      )}
      onClick={() => props.onOpen(props.skill)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen(props.skill);
        }
      }}
      aria-label={t("skills_marketplace.view_detail", { name: props.skill.displayName })}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <SkillIcon skill={props.skill} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-5 text-dls-text">
                {props.skill.displayName}
              </div>
              {props.skill.skillName &&
              props.skill.skillName !== props.skill.displayName ? (
                <div className="mt-0.5 truncate text-xs leading-5 text-dls-secondary">
                  {props.skill.skillName}
                </div>
              ) : null}
            </div>
            {props.installed ? (
              <span
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-dls-surface-muted text-dls-secondary"
                aria-label={t("skills_marketplace.installed")}
                title={t("skills_marketplace.installed")}
              >
                <Check className="size-3.5" />
              </span>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={props.installing}
                      className="shrink-0 bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag"
                      aria-label={t("skills_marketplace.install_skill", {
                        name: props.skill.displayName,
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onInstall(props.skill);
                      }}
                    >
                      {props.installing ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                    </Button>
                  }
                />
                <TooltipContent side="top">
                  <span>{t("skills_marketplace.install")}</span>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-dls-secondary">
        {props.skill.description}
      </p>
      <SkillCardChipRow chips={chips} />
    </div>
  );
}

const SKILL_ENABLED_STORAGE_KEY = "onmyagent.installed-skills.enabled";

function readSkillEnabledMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SKILL_ENABLED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

function writeSkillEnabledMap(map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SKILL_ENABLED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Installed skill tile — reference “我安装的” interaction:
 * icon + title, description, overflow menu, enable switch.
 */
function InstalledSkillCard(props: {
  skill: LocalSkillCard;
  marketplaceSkill: SkillMarketplaceEntry | null;
  enabled: boolean;
  opening: boolean;
  uninstalling: boolean;
  onEnabledChange: (skill: LocalSkillCard, enabled: boolean) => void;
  onOpenFolder: (skill: LocalSkillCard) => void;
  onOpen?: (skill: LocalSkillCard) => void;
  onUninstall: (skill: LocalSkillCard) => void;
}) {
  const description = skillDescription(props.skill);
  const name = skillDisplayName(props.skill);
  const chips = props.marketplaceSkill ? skillCardChips(props.marketplaceSkill) : [];
  const readonly = Boolean(props.skill.readonly);

  return (
    <div
      className={cn(
        "group flex h-full min-h-36 flex-col rounded-2xl border border-transparent bg-dls-surface px-4 py-3.5 text-left transition-colors",
        "hover:border-dls-border hover:bg-dls-hover",
        !props.enabled && "opacity-70",
        "mac:titlebar-no-drag",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {props.marketplaceSkill ? (
          <SkillIcon skill={props.marketplaceSkill} />
        ) : (
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-dls-surface-muted text-sm font-semibold text-dls-secondary">
            {skillFallbackInitial(name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-1.5">
            <button
              type="button"
              className={cn(
                "min-w-0 flex-1 text-left",
                props.onOpen && "cursor-pointer",
              )}
              onClick={() => props.onOpen?.(props.skill)}
              disabled={!props.onOpen}
            >
              <div className="truncate text-sm font-semibold leading-5 text-dls-text">
                {name}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                      aria-label={t("skills_marketplace.more_actions", { name })}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent
                  align="end"
                  sideOffset={6}
                  className="min-w-36 border border-dls-border bg-dls-surface p-1.5 text-dls-text"
                >
                  {props.onOpen ? (
                    <DropdownMenuItem
                      onClick={() => props.onOpen?.(props.skill)}
                      className="text-dls-text focus:bg-dls-hover"
                    >
                      {t("skills_marketplace.view_detail_short")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    disabled={props.opening || !isDesktopRuntime() || !props.skill.path}
                    onClick={() => props.onOpenFolder(props.skill)}
                    className="text-dls-text focus:bg-dls-hover"
                  >
                    <FolderOpen className="size-4" />
                    {t("skills_marketplace.open_folder")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={readonly || props.uninstalling}
                    onClick={() => props.onUninstall(props.skill)}
                  >
                    <Trash2 className="size-4" />
                    {readonly
                      ? t("skills.builtin_readonly_uninstall")
                      : t("skills.uninstall")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Switch
                checked={props.enabled}
                disabled={readonly}
                aria-label={t("skills_marketplace.toggle_enabled", { name })}
                onCheckedChange={(next) => props.onEnabledChange(props.skill, next)}
              />
            </div>
          </div>
        </div>
      </div>
      {description ? (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-dls-secondary">
          {description}
        </p>
      ) : null}
      <SkillCardChipRow chips={chips} />
    </div>
  );
}

function MarketplaceSkillDetailDialog(props: {
  skill: SkillMarketplaceEntry | null;
  installed: boolean;
  installing: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (skill: SkillMarketplaceEntry) => void;
}) {
  const skill = props.skill;
  const open = Boolean(skill);
  // Prefer i18n category labels over bilingual searchLabel used for filter haystacks.
  const categories = skill
    ? Array.from(
        new Set(skill.categoryIds.map(skillCategoryDisplayLabel).filter(Boolean)),
      )
    : [];
  const tags = skill?.tags ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onOpenChange(false);
      }}
    >
      <DialogContent className="flex max-h-[min(88vh,36rem)] w-full max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>{skill?.displayName ?? t("skills_marketplace.install")}</DialogTitle>
          <DialogDescription>
            {skill?.description ?? t("skills_marketplace.install")}
          </DialogDescription>
        </DialogHeader>
        {skill ? (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 pr-12">
            <header className="flex items-start gap-3">
              <SkillIcon skill={skill} />
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-medium leading-6 text-dls-text">
                  {skill.displayName}
                </h2>
                <p className="mt-1 text-sm leading-6 text-dls-secondary">
                  {skill.description}
                </p>
              </div>
            </header>

            {categories.length > 0 || tags.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-dls-secondary">
                  {t("skills_marketplace.detail_meta")}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((label) => (
                    <StatusBadge key={`cat-${label}`} tone="surface" shape="soft" size="tiny">
                      {label}
                    </StatusBadge>
                  ))}
                  {tags.map((tag) => (
                    <StatusBadge key={`tag-${tag}`} tone="neutral" shape="soft" size="tiny">
                      {tag}
                    </StatusBadge>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-dls-border/50 pt-4">
              {props.installed ? (
                <StatusBadge tone="success" shape="soft" size="sm">
                  <Check className="size-3.5" aria-hidden />
                  {t("skills_marketplace.installed")}
                </StatusBadge>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={props.installing}
                  onClick={() => props.onInstall(skill)}
                  className="mac:titlebar-no-drag"
                >
                  {props.installing ? (
                    <LoadingSpinner size="sm" className="mr-1.5" />
                  ) : (
                    <Plus data-icon="inline-start" className="size-4" />
                  )}
                  {t("skills_marketplace.install")}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ImportSkillDialog(props: {
  open: boolean;
  importing: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onImportFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    props.onImportFiles(Array.from(fileList));
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl gap-4 rounded-xl bg-dls-surface p-6 text-dls-text sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("skills_marketplace.import_title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("skills_marketplace.import_drop")}
          </DialogDescription>
        </DialogHeader>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".md,.zip"
          multiple
          onChange={(event) => {
            handleFiles(event.currentTarget.files);
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
            void filesFromDataTransfer(event.dataTransfer).then((files) => {
              props.onImportFiles(files);
            });
          }}
          className={cn(
            "flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-dls-border bg-dls-background text-center transition-colors mac:titlebar-no-drag",
            dragActive ? "border-dls-accent bg-dls-hover" : "hover:border-dls-border hover:bg-dls-hover",
            props.importing && "cursor-wait opacity-70",
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-md border border-dls-border bg-dls-surface text-dls-secondary">
            {props.importing ? <LoadingSpinner size="default" /> : <Upload className="size-4" />}
          </span>
          <span className="text-sm text-dls-text">{t("skills_marketplace.import_drop")}</span>
        </button>
        {props.error ? (
          <p className="text-xs leading-5 text-dls-status-danger-fg">{props.error}</p>
        ) : null}
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

export function SkillsMarketplacePage(props: {
  workspaceId: string;
  workspaceRoot?: string | null;
  client?: OnMyAgentServerClient | null;
  query?: string;
  view?: "market" | "installed";
  importOpen?: boolean;
  onImportOpenChange?: (open: boolean) => void;
  onInstalledCountChange?: (count: number) => void;
}) {
  const [categoryId, setCategoryId] = useState("all");
  const [installedSkills, setInstalledSkills] = useState<LocalSkillCard[]>([]);
  const [installedSkillNames, setInstalledSkillNames] = useState<Set<string>>(
    () => new Set(),
  );
  const [installingSkillName, setInstallingSkillName] = useState<string | null>(null);
  const [openingSkillPath, setOpeningSkillPath] = useState<string | null>(null);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<string | null>(null);
  const [skillEnabledMap, setSkillEnabledMap] = useState<Record<string, boolean>>(() =>
    readSkillEnabledMap(),
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [detailSkill, setDetailSkill] = useState<SkillMarketplaceEntry | null>(null);

  useEffect(() => {
    if (!isDesktopRuntime() || !props.workspaceRoot) return undefined;
    let cancelled = false;
    listLocalSkills(props.workspaceRoot)
      .then((response) => {
        if (cancelled || !Array.isArray(response)) return;
        const names = new Set<string>();
        const skills: LocalSkillCard[] = [];
        for (const entry of response) {
          if (isOnmyagentSkillPath(entry.path)) {
            names.add(entry.name);
            skills.push(entry);
          }
        }
        setInstalledSkillNames(names);
        setInstalledSkills(skills);
        props.onInstalledCountChange?.(skills.length);
      })
      .catch((error) => {
        console.warn("[skills-marketplace] failed to list installed skills", error);
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspaceRoot, props.onInstalledCountChange]);

  const filteredSkills = useMemo(() => {
    const normalizedQuery = (props.query ?? "").trim().toLowerCase();
    return BUILTIN_MARKETPLACE_SKILLS.filter((skill) => {
      if (!skillMatchesCategory(skill, categoryId)) return false;
      if (!normalizedQuery) return true;
      const text = [
        skill.skillName,
        skill.displayName,
        skill.description,
        skill.categoryLabel,
        ...skill.categoryLabels,
        ...skill.tags,
      ].join(" ").toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [categoryId, props.query]);

  const handleInstallSkill = async (skill: SkillMarketplaceEntry) => {
    if (installingSkillName) return;
    setInstallingSkillName(skill.skillName);
    try {
      if (!isDesktopRuntime()) {
        throw new Error("Desktop runtime is required to install built-in skills");
      }
      const result = await installBuiltinSkillPackage({
        source: "builtin",
        packageName: skill.packageName,
        skillName: skill.skillName,
      });
      const nextSkill: LocalSkillCard = {
        name: skill.skillName,
        path: result.path,
        description: skill.description,
        displayNameZh: skill.displayName,
      };
      setInstalledSkillNames((current) => {
        const next = new Set(current);
        next.add(skill.skillName);
        return next;
      });
      setInstalledSkills((current) => {
        if (current.some((item) => item.name === skill.skillName)) return current;
        const next = [...current, nextSkill].sort((a, b) => a.name.localeCompare(b.name));
        props.onInstalledCountChange?.(next.length);
        return next;
      });
    } catch (error) {
      console.warn("[skills-marketplace] failed to install skill", error);
    } finally {
      setInstallingSkillName(null);
    }
  };

  const handleImportFiles = async (files: File[]) => {
    if (importing) return;
    const file = findSkillMarkdownFile(files);
    if (!file) {
      setImportError(t("skills_marketplace.import_no_skill_md"));
      return;
    }
    if (!props.client) {
      setImportError(t("skills_marketplace.import_client_unavailable"));
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const skill = await readSkillMarkdown(file);
      const result = await props.client.upsertSkill(props.workspaceId, skill);
      setInstalledSkillNames((current) => {
        const next = new Set(current);
        next.add(skill.name);
        return next;
      });
      setInstalledSkills((current) => {
        const nextSkill: LocalSkillCard = {
          name: skill.name,
          path: result.path.replace(/[/\\]SKILL\.md$/i, ""),
          description: skill.description,
        };
        const withoutExisting = current.filter((item) => item.name !== skill.name);
        const next = [...withoutExisting, nextSkill].sort((a, b) => a.name.localeCompare(b.name));
        props.onInstalledCountChange?.(next.length);
        return next;
      });
      props.onImportOpenChange?.(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t("skills_marketplace.import_failed"));
    } finally {
      setImporting(false);
    }
  };

  const handleOpenSkillFolder = async (skill: LocalSkillCard) => {
    if (!skill.path || openingSkillPath) return;
    setOpeningSkillPath(skill.path);
    try {
      await openDesktopPath(skill.path);
    } catch (error) {
      console.warn("[skills-marketplace] failed to open skill folder", error);
    } finally {
      setOpeningSkillPath(null);
    }
  };

  const handleSkillEnabledChange = (skill: LocalSkillCard, enabled: boolean) => {
    setSkillEnabledMap((current) => {
      const next = { ...current, [skill.name]: enabled };
      writeSkillEnabledMap(next);
      return next;
    });
  };

  const handleUninstallSkill = async (skill: LocalSkillCard) => {
    if (skill.readonly || uninstallingSkillName) return;
    setUninstallingSkillName(skill.name);
    try {
      if (props.client) {
        await props.client.deleteSkill(props.workspaceId, skill.name);
      } else if (props.workspaceRoot?.trim()) {
        const result = (await uninstallSkill(
          props.workspaceRoot.trim(),
          skill.name,
        )) as { ok?: boolean; stderr?: string; stdout?: string };
        if (result && result.ok === false) {
          throw new Error(result.stderr || result.stdout || t("skills.uninstall_failed"));
        }
      } else {
        throw new Error(t("skills.pick_workspace_first"));
      }
      setInstalledSkills((current) => {
        const next = current.filter((item) => item.name !== skill.name);
        props.onInstalledCountChange?.(next.length);
        return next;
      });
      setInstalledSkillNames((current) => {
        const next = new Set(current);
        next.delete(skill.name);
        return next;
      });
    } catch (error) {
      console.warn("[skills-marketplace] failed to uninstall skill", error);
    } finally {
      setUninstallingSkillName(null);
    }
  };

  const filteredInstalledSkills = useMemo(() => {
    const normalizedQuery = (props.query ?? "").trim().toLowerCase();
    if (!normalizedQuery) return installedSkills;
    return installedSkills.filter((skill) => {
      const text = [
        skillDisplayName(skill),
        skill.name,
        skillDescription(skill),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [installedSkills, props.query]);

  if (props.view === "installed") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-dls-background">
        <MarketplaceSkillDetailDialog
          skill={detailSkill}
          installed={
            detailSkill ? installedSkillNames.has(detailSkill.skillName) : false
          }
          installing={
            detailSkill ? installingSkillName === detailSkill.skillName : false
          }
          onOpenChange={(open) => {
            if (!open) setDetailSkill(null);
          }}
          onInstall={handleInstallSkill}
        />
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pb-1 pt-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-semibold leading-6 text-dls-text">
              {t("store.my_installed")}
            </h2>
            <CountBadge size="dot">{installedSkills.length}</CountBadge>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
          {filteredInstalledSkills.length > 0 ? (
            <div className={SKILL_CARD_GRID}>
              {filteredInstalledSkills.map((skill) => {
                const market = marketplaceSkillForLocalSkill(skill);
                const enabled = skillEnabledMap[skill.name] !== false;
                return (
                  <InstalledSkillCard
                    key={skill.name}
                    skill={skill}
                    marketplaceSkill={market}
                    enabled={enabled}
                    opening={openingSkillPath === skill.path}
                    uninstalling={uninstallingSkillName === skill.name}
                    onEnabledChange={handleSkillEnabledChange}
                    onOpenFolder={handleOpenSkillFolder}
                    onUninstall={handleUninstallSkill}
                    onOpen={
                      market
                        ? () => setDetailSkill(market)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-0 items-center justify-center px-6 text-center text-sm text-dls-secondary">
              {installedSkills.length === 0
                ? t("store.no_skills_installed")
                : t("skills_marketplace.installed_no_match")}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-dls-background">
      <ImportSkillDialog
        open={props.importOpen ?? false}
        importing={importing}
        error={importError}
        onOpenChange={(open) => {
          if (!open && importing) return;
          if (open) setImportError(null);
          props.onImportOpenChange?.(open);
        }}
        onImportFiles={handleImportFiles}
      />
      <MarketplaceSkillDetailDialog
        skill={detailSkill}
        installed={
          detailSkill ? installedSkillNames.has(detailSkill.skillName) : false
        }
        installing={
          detailSkill ? installingSkillName === detailSkill.skillName : false
        }
        onOpenChange={(open) => {
          if (!open) setDetailSkill(null);
        }}
        onInstall={handleInstallSkill}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-1.5 px-6 py-2.5">
        {SKILL_MARKETPLACE_CATEGORIES.map((category) => {
          const active = categoryId === category.id;
          return (
            <FilterChip
              key={category.id}
              label={t(category.labelKey)}
              selected={active}
              onClick={() => setCategoryId(category.id)}
              className="mac:titlebar-no-drag"
            />
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <div className={SKILL_CARD_GRID}>
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              installed={installedSkillNames.has(skill.skillName)}
              installing={installingSkillName === skill.skillName}
              onInstall={handleInstallSkill}
              onOpen={setDetailSkill}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
