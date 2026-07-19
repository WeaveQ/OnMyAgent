/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FolderOpen, Plus, Upload } from "lucide-react";

import {
  installBuiltinSkillPackage,
  listLocalSkills,
  openDesktopPath,
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
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { SKILL_MARKETPLACE_CATEGORIES } from "./categories";
import { BUILTIN_MARKETPLACE_SKILLS } from "./data";
import type { SkillMarketplaceEntry } from "./types";

/** Align with plugins store: 1 → 2 → 3 (daily) → 5 (large). */
const SKILL_CARD_GRID =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-5";

const OPC_AGGREGATED_CATEGORY_IDS = new Set([
  "developer",
  "deploy",
  "productivity",
  "office",
]);

function skillFallbackInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "S";
}

function SkillIcon(props: { skill: SkillMarketplaceEntry }) {
  if (props.skill.iconUrl) {
    return (
      <img
        src={props.skill.iconUrl}
        alt=""
        className="size-8 shrink-0 rounded-md object-cover ring-1 ring-dls-border"
      />
    );
  }
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface-muted text-sm font-semibold text-dls-secondary ring-1 ring-dls-border">
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
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group flex h-full min-h-[5.5rem] cursor-pointer items-center gap-2.5 rounded-xl border border-dls-border/50 bg-dls-surface px-3.5 py-3 transition-colors",
        "hover:border-dls-border hover:bg-dls-hover/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
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
      <SkillIcon skill={props.skill} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-5 text-dls-text">
          {props.skill.displayName}
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
          {props.skill.description}
        </div>
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
  );
}

function InstalledSkillCard(props: {
  skill: LocalSkillCard;
  marketplaceSkill: SkillMarketplaceEntry | null;
  opening: boolean;
  onOpenFolder: (skill: LocalSkillCard) => void;
  onOpen?: (skill: LocalSkillCard) => void;
}) {
  const description = skillDescription(props.skill);
  const name = skillDisplayName(props.skill);
  return (
    <div
      role={props.onOpen ? "button" : undefined}
      tabIndex={props.onOpen ? 0 : undefined}
      className={cn(
        "group flex h-full min-h-[5.5rem] items-start gap-2.5 rounded-xl border border-dls-border/50 bg-dls-surface px-3.5 py-3 transition-colors",
        "hover:border-dls-border hover:bg-dls-hover/60",
        props.onOpen && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
      )}
      onClick={props.onOpen ? () => props.onOpen?.(props.skill) : undefined}
      onKeyDown={
        props.onOpen
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.onOpen?.(props.skill);
              }
            }
          : undefined
      }
      aria-label={
        props.onOpen ? t("skills_marketplace.view_detail", { name }) : undefined
      }
    >
      {props.marketplaceSkill ? (
        <SkillIcon skill={props.marketplaceSkill} />
      ) : (
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface-muted text-sm font-semibold text-dls-secondary ring-1 ring-dls-border">
          {skillFallbackInitial(name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-5 text-dls-text">{name}</div>
        {description ? (
          <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
            {description}
          </div>
        ) : null}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={props.opening || !isDesktopRuntime()}
              className="shrink-0 bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag"
              aria-label={t("skills_marketplace.open_skill_folder", {
                name,
              })}
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenFolder(props.skill);
              }}
            >
              {props.opening ? (
                <LoadingSpinner size="sm" />
              ) : (
                <FolderOpen className="size-4" />
              )}
            </Button>
          }
        />
        <TooltipContent side="top">
          <span>{t("skills_marketplace.open_folder")}</span>
        </TooltipContent>
      </Tooltip>
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
  const categories = skill
    ? Array.from(new Set([skill.categoryLabel, ...skill.categoryLabels].filter(Boolean)))
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
      const categoryMatches =
        skill.categoryId === categoryId ||
        skill.categoryIds.includes(categoryId) ||
        (
          categoryId === "opc" &&
          (
            OPC_AGGREGATED_CATEGORY_IDS.has(skill.categoryId) ||
            skill.categoryIds.some((id) => OPC_AGGREGATED_CATEGORY_IDS.has(id))
          )
        );
      if (
        categoryId !== "all" &&
        !categoryMatches
      ) {
        return false;
      }
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
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {installedSkills.length > 0 ? (
            <div className={SKILL_CARD_GRID}>
              {installedSkills.map((skill) => {
                const market = marketplaceSkillForLocalSkill(skill);
                return (
                  <InstalledSkillCard
                    key={skill.name}
                    skill={skill}
                    marketplaceSkill={market}
                    opening={openingSkillPath === skill.path}
                    onOpenFolder={handleOpenSkillFolder}
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
              {t("store.no_skills_installed")}
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
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-6 py-2.5">
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
