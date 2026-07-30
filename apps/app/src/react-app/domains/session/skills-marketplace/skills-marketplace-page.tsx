/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import {
  installBuiltinSkillPackage,
  listBuiltinSkillCatalog,
  listLocalSkills,
  uninstallSkill,
} from "@/app/lib/desktop";
import type { LocalSkillCard } from "@/app/lib/desktop";
import type { OnMyAgentServerClient } from "@/app/lib/onmyagent-server";
import { isDesktopRuntime } from "@/app/utils";
import {
  FilterChip,
  NavTabButton,
  SegmentedTabGroup,
} from "@/components/ui/action-row";
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
  readPinnedSkillIds,
  sortWithPinnedFirst,
  writePinnedSkillIds,
} from "../surface/composer/pinned-skills";
import {
  SKILL_MARKETPLACE_CATEGORIES,
} from "./categories";
import { BUILTIN_MARKETPLACE_SKILLS } from "./data";
import type { SkillMarketplaceEntry } from "./types";

/** Align with expert marketplace grid density. */
const SKILL_CARD_GRID =
  "grid grid-cols-1 items-start gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
/** Installed/builtin mine list — same grid; cards hug content (no stretched empty belly). */
const SKILL_INSTALLED_CARD_GRID = SKILL_CARD_GRID;

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
        "group flex h-full min-h-36 cursor-pointer flex-col rounded-2xl border border-transparent bg-dls-surface px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow]",
        // Light: list-selected + border-strong reads clearly on white (list-hover is too soft).
        "hover:border-dls-border-strong hover:bg-dls-list-selected hover:shadow-sm dark:hover:border-dls-border-strong dark:hover:bg-dls-list-selected dark:hover:shadow-none",
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
 * Installed skill tile — reference layout:
 * [avatar] name  [类型徽标]     ···  pin  sm-switch
 *          description (2 lines)
 * Menu: 去对话 / 编辑 / 卸载
 */
function InstalledSkillCard(props: {
  skill: LocalSkillCard;
  marketplaceSkill: SkillMarketplaceEntry | null;
  enabled: boolean;
  pinned: boolean;
  uninstalling: boolean;
  /** Product-packaged origin (core preinstall / builtin catalog). */
  originBuiltin?: boolean;
  onEnabledChange: (skill: LocalSkillCard, enabled: boolean) => void;
  onPinnedChange: (skill: LocalSkillCard, pinned: boolean) => void;
  onChat?: (skill: LocalSkillCard) => void;
  onEdit?: (skill: LocalSkillCard) => void;
  onOpen?: (skill: LocalSkillCard) => void;
  onUninstall: (skill: LocalSkillCard) => void;
}) {
  const description = skillDescription(props.skill);
  const name = skillDisplayName(props.skill);
  const typeLabel = props.originBuiltin
    ? t("skills.source_builtin")
    : t("skills.source_user_installed");

  const handleCardActivate = () => {
    if (props.onOpen) {
      props.onOpen(props.skill);
      return;
    }
    props.onChat?.(props.skill);
  };
  const cardInteractive = Boolean(props.onOpen || props.onChat);

  return (
    <div
      role={cardInteractive ? "button" : undefined}
      tabIndex={cardInteractive ? 0 : undefined}
      data-enabled={props.enabled ? "true" : "false"}
      className={cn(
        // Hug content — no h-full stretch (that left a hollow band under the text).
        "group flex w-full flex-col rounded-2xl border border-transparent px-3.5 py-2.5 text-left transition-[background-color,border-color,box-shadow]",
        // Enabled: surface rest. Hover/active uses list-selected so dark theme lifts
        // clearly off black canvas (#2C → #45); list-hover is nearly invisible on dark.
        props.enabled
          ? "bg-dls-surface hover:border-dls-border-strong hover:bg-dls-list-selected hover:shadow-sm dark:hover:border-dls-border-strong dark:hover:bg-dls-list-selected dark:hover:shadow-none"
          : "bg-dls-surface-muted/40 hover:border-dls-border hover:bg-dls-list-selected/80 hover:shadow-sm dark:hover:bg-dls-list-selected/70 dark:hover:shadow-none",
        cardInteractive && "cursor-pointer",
        "focus-visible:border-dls-border-strong focus-visible:bg-dls-list-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
        "mac:titlebar-no-drag",
      )}
      onClick={cardInteractive ? handleCardActivate : undefined}
      onKeyDown={
        cardInteractive
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleCardActivate();
              }
            }
          : undefined
      }
    >
      {/*
        Layout: icon | [ title row (name…actions) ]
                       [ description 2 lines — full width under the switch ]
        Description must sit under the action cluster so the right side is not hollow.
      */}
      <div className="flex min-w-0 items-start gap-2.5">
        <div
          className={cn(
            "shrink-0 transition-[opacity,filter]",
            !props.enabled && "opacity-45 grayscale-[0.35]",
          )}
        >
          {props.marketplaceSkill ? (
            <SkillIcon skill={props.marketplaceSkill} />
          ) : (
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-dls-surface-muted text-sm font-semibold text-dls-secondary">
              {skillFallbackInitial(name)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 transition-[opacity,filter]",
                !props.enabled && "opacity-45 grayscale-[0.35]",
              )}
            >
              <span
                className={cn(
                  "truncate text-sm font-semibold leading-5",
                  props.enabled ? "text-dls-text" : "text-dls-secondary",
                )}
              >
                {name}
              </span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none",
                  props.originBuiltin && props.enabled
                    ? "bg-dls-accent/12 text-dls-accent"
                    : "bg-dls-surface-muted text-dls-secondary",
                )}
              >
                {typeLabel}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {/* ··· / pin: hover-only; pinned pin stays visible so state is scannable */}
              <div
                className={cn(
                  "flex items-center gap-0.5 transition-opacity",
                  "pointer-events-none opacity-0",
                  "group-hover:pointer-events-auto group-hover:opacity-100",
                  "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                  "has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100",
                  "has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
                  props.pinned && "pointer-events-auto opacity-100",
                )}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
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
                    className="min-w-36 border border-dls-border bg-dls-surface-solid p-1.5 text-dls-text"
                  >
                    <DropdownMenuItem
                      disabled={!props.onChat}
                      onClick={() => props.onChat?.(props.skill)}
                      className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
                    >
                      <MessageCircle className="size-4 shrink-0 text-dls-secondary" />
                      {t("store.skill_go_chat")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!props.onEdit}
                      onClick={() => props.onEdit?.(props.skill)}
                      className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
                    >
                      <Pencil className="size-4 shrink-0 text-dls-secondary" />
                      {t("store.skill_edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={props.uninstalling || props.skill.readonly}
                      onClick={() => props.onUninstall(props.skill)}
                      className="cursor-pointer"
                    >
                      <Trash2 className="size-4" />
                      {t("skills.uninstall")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className={cn(
                          "hover:bg-dls-hover",
                          props.pinned
                            ? "text-dls-accent hover:text-dls-accent"
                            : "text-dls-secondary hover:text-dls-text",
                        )}
                        aria-label={
                          props.pinned
                            ? t("store.skill_unpin")
                            : t("store.skill_pin")
                        }
                        aria-pressed={props.pinned}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onPinnedChange(props.skill, !props.pinned);
                        }}
                      >
                        <Pin
                          className={cn(
                            "size-3.5 -rotate-45",
                            props.pinned && "fill-current",
                          )}
                        />
                      </Button>
                    }
                  />
                  <TooltipContent side="top">
                    <span>
                      {props.pinned
                        ? t("store.skill_unpin")
                        : t("store.skill_pin")}
                    </span>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div
                className="cursor-default"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Switch
                  size="sm"
                  checked={props.enabled}
                  aria-label={t("skills_marketplace.toggle_enabled", { name })}
                  onCheckedChange={(next) =>
                    props.onEnabledChange(props.skill, next)
                  }
                />
              </div>
            </div>
          </div>
          {/* 2 lines, full width of title+actions column → text reaches under the switch. */}
          <p
            className={cn(
              "mt-1 line-clamp-2 min-h-9 text-xs leading-4.5 transition-[opacity,filter]",
              props.enabled ? "text-dls-secondary" : "text-dls-secondary/70 opacity-45",
              !props.enabled && "grayscale-[0.35]",
            )}
            title={description || undefined}
          >
            {description || "\u00a0"}
          </p>
        </div>
      </div>
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

type InstalledSkillsSubTab = "builtin" | "installed";

/**
 * Fallback when listBuiltinSkillCatalog is unavailable (older desktop / IPC fail).
 * Keep in sync with apps/desktop/electron/builtin-skills-policy.mjs package names.
 */
const FALLBACK_BUILTIN_PACKAGE_NAMES = new Set([
  "browser-automation",
  "browser-skill",
  "canvas-design",
  "computer-use",
  "create-automation",
  "doc-coauthoring",
  "expert-manager",
  "find-skills",
  "frontend-design",
  "github",
  "pptx",
  "qcc-company",
  "self-improving",
  "self-improving-agent",
  "skill-creator",
  "tencent-docs",
  "tencent-meeting-skill",
  "weather",
  "web-artifacts-builder",
  "webapp-testing",
  "wecom-unified",
]);

export function SkillsMarketplacePage(props: {
  workspaceId: string;
  workspaceRoot?: string | null;
  client?: OnMyAgentServerClient | null;
  query?: string;
  view?: "market" | "installed";
  importOpen?: boolean;
  onImportOpenChange?: (open: boolean) => void;
  onInstalledCountChange?: (count: number) => void;
  /** Open chat with skill slash chip pre-seeded. */
  onChatWithSkill?: (skill: LocalSkillCard) => void;
  /** Open chat with skill-creator + skill for edit. */
  onEditSkill?: (skill: LocalSkillCard) => void;
}) {
  const [categoryId, setCategoryId] = useState("all");
  const [installedSkills, setInstalledSkills] = useState<LocalSkillCard[]>([]);
  const [installedSkillNames, setInstalledSkillNames] = useState<Set<string>>(
    () => new Set(),
  );
  /** Product bundled package names (catalog) — used to split built-in vs installed. */
  const [builtinPackageNames, setBuiltinPackageNames] = useState<Set<string>>(
    () => new Set(),
  );
  const [installedSubTab, setInstalledSubTab] =
    useState<InstalledSkillsSubTab>("builtin");
  const [installingSkillName, setInstallingSkillName] = useState<string | null>(null);
  const [uninstallingSkillName, setUninstallingSkillName] = useState<string | null>(null);
  const [skillEnabledMap, setSkillEnabledMap] = useState<Record<string, boolean>>(() =>
    readSkillEnabledMap(),
  );
  /** Shared with composer + menu pins (`skill:<name>`). */
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>(() =>
    readPinnedSkillIds(),
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [detailSkill, setDetailSkill] = useState<SkillMarketplaceEntry | null>(null);

  useEffect(() => {
    if (!isDesktopRuntime() || !props.workspaceRoot) return undefined;
    let cancelled = false;
    void Promise.all([
      listLocalSkills(props.workspaceRoot),
      listBuiltinSkillCatalog().catch(() => ({ skills: [] })),
    ])
      .then(([response, catalog]) => {
        if (cancelled) return;
        const names = new Set<string>();
        const skills: LocalSkillCard[] = [];
        if (Array.isArray(response)) {
          for (const entry of response) {
            if (isOnmyagentSkillPath(entry.path)) {
              names.add(entry.name);
              skills.push(entry);
            }
          }
        }
        setInstalledSkillNames(names);
        setInstalledSkills(skills);
        props.onInstalledCountChange?.(skills.length);

        const builtinNames = new Set(FALLBACK_BUILTIN_PACKAGE_NAMES);
        for (const entry of catalog?.skills ?? []) {
          if (entry.skillName) builtinNames.add(entry.skillName);
          if (entry.packageName) builtinNames.add(entry.packageName);
        }
        setBuiltinPackageNames(builtinNames);
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

  const handleSkillEnabledChange = (skill: LocalSkillCard, enabled: boolean) => {
    setSkillEnabledMap((current) => {
      const next = { ...current, [skill.name]: enabled };
      writeSkillEnabledMap(next);
      return next;
    });
  };

  const isSkillPinned = (skillName: string) => {
    const primaryId = `skill:${skillName}`;
    return (
      pinnedSkillIds.includes(primaryId) ||
      pinnedSkillIds.includes(`cmd:${skillName}`) ||
      pinnedSkillIds.includes(skillName)
    );
  };

  const handleSkillPinnedChange = (skill: LocalSkillCard, pinned: boolean) => {
    const primaryId = `skill:${skill.name}`;
    setPinnedSkillIds((current) => {
      const aliases = new Set([primaryId, `cmd:${skill.name}`, skill.name]);
      const stripped = current.filter((id) => !aliases.has(id));
      const next = pinned ? [primaryId, ...stripped].slice(0, 24) : stripped;
      writePinnedSkillIds(next);
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

  const isBuiltinOriginSkill = (skill: LocalSkillCard) =>
    builtinPackageNames.has(skill.name);

  const { builtinInstalled, userInstalled } = useMemo(() => {
    const builtin: LocalSkillCard[] = [];
    const user: LocalSkillCard[] = [];
    for (const skill of installedSkills) {
      if (isBuiltinOriginSkill(skill)) builtin.push(skill);
      else user.push(skill);
    }
    return { builtinInstalled: builtin, userInstalled: user };
  }, [installedSkills, builtinPackageNames]);

  const filteredInstalledSkills = useMemo(() => {
    const source =
      installedSubTab === "builtin" ? builtinInstalled : userInstalled;
    const normalizedQuery = (props.query ?? "").trim().toLowerCase();
    const filtered = !normalizedQuery
      ? source
      : source.filter((skill) => {
          const text = [
            skillDisplayName(skill),
            skill.name,
            skillDescription(skill),
          ]
            .join(" ")
            .toLowerCase();
          return text.includes(normalizedQuery);
        });
    // Pinned skills first (same order as composer tool menu).
    return sortWithPinnedFirst(filtered, pinnedSkillIds, (skill) => {
      const primaryId = `skill:${skill.name}`;
      if (pinnedSkillIds.includes(primaryId)) return primaryId;
      if (pinnedSkillIds.includes(`cmd:${skill.name}`)) return `cmd:${skill.name}`;
      if (pinnedSkillIds.includes(skill.name)) return skill.name;
      return primaryId;
    });
  }, [
    builtinInstalled,
    userInstalled,
    installedSubTab,
    props.query,
    pinnedSkillIds,
  ]);

  if (props.view === "installed") {
    const emptyForSubTab =
      installedSubTab === "builtin"
        ? builtinInstalled.length === 0
        : userInstalled.length === 0;
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
        {/* Free-float pills like files Mine / Drive tabs — no track, inverted active fill. */}
        <div className="flex shrink-0 items-center px-6 pb-1 pt-1">
          <SegmentedTabGroup density="bare" className="mac:titlebar-no-drag">
            <NavTabButton
              type="button"
              active={installedSubTab === "builtin"}
              size="tab"
              shape="tab"
              aria-pressed={installedSubTab === "builtin"}
              onClick={() => setInstalledSubTab("builtin")}
            >
              <span>{t("skills.mine_tab_builtin")}</span>
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  installedSubTab === "builtin"
                    ? "opacity-70"
                    : "text-dls-secondary",
                )}
              >
                {builtinInstalled.length}
              </span>
            </NavTabButton>
            <NavTabButton
              type="button"
              active={installedSubTab === "installed"}
              size="tab"
              shape="tab"
              aria-pressed={installedSubTab === "installed"}
              onClick={() => setInstalledSubTab("installed")}
            >
              <span>{t("skills.mine_tab_installed")}</span>
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  installedSubTab === "installed"
                    ? "opacity-70"
                    : "text-dls-secondary",
                )}
              >
                {userInstalled.length}
              </span>
            </NavTabButton>
          </SegmentedTabGroup>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
          {filteredInstalledSkills.length > 0 ? (
            <div className={SKILL_INSTALLED_CARD_GRID}>
              {filteredInstalledSkills.map((skill) => {
                const market = marketplaceSkillForLocalSkill(skill);
                const enabled = skillEnabledMap[skill.name] !== false;
                const originBuiltin = isBuiltinOriginSkill(skill);
                return (
                  <InstalledSkillCard
                    key={skill.name}
                    skill={skill}
                    marketplaceSkill={market}
                    enabled={enabled}
                    pinned={isSkillPinned(skill.name)}
                    originBuiltin={originBuiltin}
                    uninstalling={uninstallingSkillName === skill.name}
                    onEnabledChange={handleSkillEnabledChange}
                    onPinnedChange={handleSkillPinnedChange}
                    onChat={props.onChatWithSkill}
                    onEdit={props.onEditSkill}
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
              {emptyForSubTab
                ? installedSubTab === "builtin"
                  ? t("skills.mine_builtin_empty")
                  : t("skills.mine_user_empty")
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
