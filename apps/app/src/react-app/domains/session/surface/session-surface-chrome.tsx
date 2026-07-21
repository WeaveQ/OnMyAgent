/** @jsxImportSource react */
/**
 * Session surface chrome — header, draft-home title, draft workspace accessory.
 * Extracted from session-surface.tsx (mechanical UI move).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { pickDirectory } from "../../../../app/lib/desktop";
import { AccessPermissionSelect } from "./composer/access-permission-select";
import type { ComposerAccessMode } from "../../../../app/types";
import {
  AssistantDraftHomeMark,
  PendingAgentAvatar,
} from "./chrome/avatars";
import { sessionSurfaceTextClass } from "./surface-styles";
import type { AssistantCategoryId } from "./personal-assistant-config";
import {
  addRecentWorkspace,
  getRecentWorkspaces,
  workspaceDisplayName,
} from "../../local-agents";
import {
  assistantSessionWorkspacesChangedEvent,
  readAssistantSessionWorkspaces,
} from "../../../capabilities/session-identity/assistant-session-workspaces";
import {
  automationSessionsChangedEvent,
  readAutomationSessionRecords,
} from "../../messaging";

export type SessionSurfaceHeaderAgent = {
  name: string;
  avatarUrl: string | null;
  avatarBackground: string | null | undefined;
};

export function SessionSurfaceHeader(props: {
  agent: SessionSurfaceHeaderAgent;
  codeSceneToolbar: ReactNode;
  personalAssistantHome?: boolean;
  onOpenAgentSettings?: () => void;
  headerActions?: ReactNode;
  /**
   * Bottom rule under the title row. Hide when the session-tab strip is
   * expanded (tabs own the single divider) to avoid double lines.
   */
  showBottomBorder?: boolean;
}) {
  const showBottomBorder = props.showBottomBorder !== false;
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center justify-between bg-dls-background px-5",
        // Align with side-panel header when this is the only chrome rule.
        showBottomBorder && "border-b border-dls-mist",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <PendingAgentAvatar
          name={props.agent.name}
          avatarUrl={props.agent.avatarUrl}
          avatarBackground={props.agent.avatarBackground ?? undefined}
          className="size-7 text-xs"
        />
        <div className={sessionSurfaceTextClass.headerAgentName}>
          {props.agent.name}
        </div>
      </div>
      <div className="relative flex items-center gap-1.5 mac:titlebar-no-drag">
        {props.codeSceneToolbar}
        {!props.personalAssistantHome && props.onOpenAgentSettings ? (
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            title={t("session.configure_current_agent")}
            aria-label={t("session.configure_current_agent")}
            onClick={props.onOpenAgentSettings}
          >
            <Settings2 className="size-4" />
          </Button>
        ) : null}
        {props.headerActions}
      </div>
    </header>
  );
}

export function SessionSurfaceDraftHome(props: {
  categoryId: AssistantCategoryId;
  title: string;
  subtitle?: string;
}) {
  return (
    // Brand hero above composer; outer shell handles upper-centered placement.
    // Generous title→composer gap so the card sits clear of the hero.
    <div className="mb-8 flex w-full flex-col items-center text-center">
      <div className="flex items-center gap-3 text-dls-text">
        <AssistantDraftHomeMark categoryId={props.categoryId} />
        <h2 className={sessionSurfaceTextClass.draftHomeTitle}>{props.title}</h2>
      </div>
      {props.subtitle ? (
        <p className={sessionSurfaceTextClass.draftHomeSubtitle}>{props.subtitle}</p>
      ) : null}
    </div>
  );
}

/** Expert empty chat: avatar + capability copy + prompt suggestions above composer. */
export function SessionSurfaceExpertEmpty(props: {
  agent: {
    name: string;
    description?: string | null;
    avatar: { avatarUrl: string | null; avatarBackground?: string | null };
  };
  promptSuggestions: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-5 py-6">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <PendingAgentAvatar
          name={props.agent.name}
          avatarUrl={props.agent.avatar.avatarUrl}
          avatarBackground={props.agent.avatar.avatarBackground ?? undefined}
          className="size-16 text-3xl"
        />
        <h2 className={sessionSurfaceTextClass.agentEmptyTitle}>{props.agent.name}</h2>
        {props.agent.description ? (
          <p className={sessionSurfaceTextClass.agentEmptyDescription}>
            {props.agent.description}
          </p>
        ) : null}
      </div>
      {props.promptSuggestions}
    </div>
  );
}

function draftWorkspaceLabel(path: string | null | undefined): string {
  const trimmed = path?.trim() ?? "";
  if (!trimmed) return "";
  return (
    trimmed
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .pop() ?? trimmed
  );
}

function sanitizeDraftSpaceName(raw: string): string {
  return raw
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "")
    .slice(0, 64)
    .trim();
}

/**
 * Draft-home workspace chip — same pattern as local-agent WorkspaceFootnote:
 * search + pick existing recent / name-a-folder under current workspace / open local.
 */
export function SessionDraftWorkspaceAccessory(props: {
  draftWorkspaceDirectory?: string | null;
  /** Active app workspace id — used to load sidebar Spaces directories. */
  ownerWorkspaceId?: string | null;
  assistantFeatureCategoryId?: AssistantCategoryId;
  showFolderRequiredBubble: boolean;
  onDismissFolderRequiredBubble: () => void;
  /** Prefer path-based select so list/create/open can all feed the same setter. */
  onSelectDraftWorkspace?: (path: string) => void;
  /**
   * Create a named subfolder under the active app workspace and return its
   * absolute path (WorkBuddy-style create-space under current workspace).
   */
  onCreateDraftWorkspace?: (name: string) => Promise<string>;
  onPickDraftWorkspace?: () => void;
  onClearDraftWorkspace?: () => void;
  accessMode: ComposerAccessMode;
  onAccessModeChange: (mode: ComposerAccessMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [listTick, setListTick] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const trimmedRoot = props.draftWorkspaceDirectory?.trim() ?? "";
  const displayName = draftWorkspaceLabel(trimmedRoot);
  const ownerWorkspaceId = props.ownerWorkspaceId?.trim() ?? "";

  // Refresh when sidebar Spaces bindings or automation records change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setListTick((value) => value + 1);
    window.addEventListener(assistantSessionWorkspacesChangedEvent, onChange);
    window.addEventListener(automationSessionsChangedEvent, onChange);
    return () => {
      window.removeEventListener(assistantSessionWorkspacesChangedEvent, onChange);
      window.removeEventListener(automationSessionsChangedEvent, onChange);
    };
  }, []);

  /**
   * Only sidebar Spaces directories — exclude automation output folders.
   * (Automation also writes assistantSessionWorkspaces; those must not appear here.)
   * Recent picks are included only when they are not automation dirs (covers
   * newly created spaces that do not yet have a session).
   */
  const knownWorkspaces = useMemo(() => {
    void listTick;
    const automationRecords = ownerWorkspaceId
      ? readAutomationSessionRecords(ownerWorkspaceId)
      : [];
    const automationSessionIds = new Set(
      automationRecords.map((record) => record.sessionId),
    );
    const automationDirs = new Set(
      automationRecords
        .map((record) => record.outputDirectory.trim())
        .filter(Boolean),
    );
    // Legacy automation folders: same prefix as automation-page LEGACY_AUTOMATION_GROUP_PREFIX.
    const LEGACY_AUTOMATION_DIR_PREFIX = "\u81EA\u52A8\u5316\u4EFB\u52A1-";
    const isAutomationDir = (path: string) => {
      const next = path.trim();
      if (!next || automationDirs.has(next)) return true;
      const base = workspaceDisplayName(next);
      return base.startsWith(LEGACY_AUTOMATION_DIR_PREFIX) || /^automation[-_]/i.test(base);
    };

    const seen = new Set<string>();
    const out: string[] = [];
    const push = (path: string) => {
      const next = path.trim();
      if (!next || seen.has(next) || isAutomationDir(next)) return;
      seen.add(next);
      out.push(next);
    };

    for (const record of readAssistantSessionWorkspaces(
      ownerWorkspaceId || undefined,
    )) {
      if (automationSessionIds.has(record.sessionId)) continue;
      push(record.directory);
    }
    // Only keep recent picks that are already known space dirs — do not re-add
    // automation leftovers that landed in localStorage recent list.
    for (const path of getRecentWorkspaces()) {
      if (isAutomationDir(path)) continue;
      // Prefer paths already in space set; still allow recent non-auto picks
      // so a freshly created space (no session yet) remains visible.
      push(path);
    }
    return out;
  }, [listTick, ownerWorkspaceId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return knownWorkspaces;
    return knownWorkspaces.filter((path) => {
      const name = workspaceDisplayName(path).toLowerCase();
      return name.includes(q) || path.toLowerCase().includes(q);
    });
  }, [query, knownWorkspaces]);

  const commitPath = useCallback(
    (path: string) => {
      const next = path.trim();
      if (!next) return;
      addRecentWorkspace(next);
      setListTick((value) => value + 1);
      props.onSelectDraftWorkspace?.(next);
      setOpen(false);
      setQuery("");
    },
    [props],
  );

  const browseLocal = useCallback(async () => {
    props.onDismissFolderRequiredBubble();
    setOpen(false);
    try {
      const directory = await pickDirectory({
        title: t("session.workspace_open_local"),
      });
      if (typeof directory === "string" && directory.trim()) {
        commitPath(directory.trim());
      }
    } catch {
      // User cancelled or desktop bridge unavailable.
    }
  }, [commitPath, props]);

  const handleSelect = useCallback(
    (path: string) => {
      props.onDismissFolderRequiredBubble();
      commitPath(path);
    },
    [commitPath, props],
  );

  const handleClear = useCallback(() => {
    setOpen(false);
    setQuery("");
    props.onClearDraftWorkspace?.();
  }, [props]);

  const openCreateDialog = useCallback(() => {
    props.onDismissFolderRequiredBubble();
    setOpen(false);
    setCreateName("");
    setCreateError(null);
    setCreateOpen(true);
  }, [props]);

  const submitCreate = useCallback(async () => {
    const name = sanitizeDraftSpaceName(createName);
    if (!name) {
      setCreateError(t("session.workspace_create_name_required"));
      return;
    }
    if (!props.onCreateDraftWorkspace) {
      // Fallback when host cannot mkdir under the active workspace.
      setCreateOpen(false);
      void browseLocal();
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const createdPath = await props.onCreateDraftWorkspace(name);
      commitPath(createdPath);
      setCreateOpen(false);
      setCreateName("");
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // Map internal artifact write errors to a user-facing create failure.
      const message =
        /artifact|edited inline|invalid_path/i.test(raw)
          ? t("session.workspace_create_failed")
          : raw || t("session.workspace_create_failed");
      setCreateError(message);
    } finally {
      setCreateBusy(false);
    }
  }, [browseLocal, commitPath, createName, props]);

  return (
    <div className="flex min-w-0 items-center gap-0.5 text-sm font-normal leading-none text-dls-secondary">
      <div className="relative inline-flex min-w-0 items-center">
        {props.showFolderRequiredBubble ? (
          <div className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg border border-dls-accent/30 bg-dls-surface px-3 py-2 text-sm leading-5 text-dls-text">
            <div className="font-medium text-dls-accent">
              {t("session.choose_folder_required_title")}
            </div>
            <div className="mt-0.5 text-dls-secondary">
              {t("session.choose_folder_required_desc")}
            </div>
            <div className="absolute -bottom-1 left-5 size-2 rotate-45 border-b border-r border-dls-accent/30 bg-dls-surface" />
          </div>
        ) : null}

        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) {
              props.onDismissFolderRequiredBubble();
              setListTick((value) => value + 1);
            } else {
              setQuery("");
            }
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn(
                  // Match composer AccessPermissionSelect trigger (text-sm / h-8).
                  "inline-flex h-8 min-w-0 items-center justify-start gap-1.5 rounded-lg px-2 text-left text-sm font-normal leading-none text-dls-secondary transition-colors",
                  "hover:bg-dls-hover hover:text-dls-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-signal/40",
                  "[&_svg]:size-3.5",
                )}
              >
                {trimmedRoot ? (
                  <>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="max-w-56 truncate text-dls-text">{displayName}</span>
                  </>
                ) : (
                  <>
                    <Folder className="size-3.5 shrink-0" />
                    <span>
                      {props.assistantFeatureCategoryId === "office"
                        ? t("session.choose_workspace")
                        : t("session.choose_folder")}
                    </span>
                  </>
                )}
                <ChevronDown className="size-3.5 shrink-0 opacity-70" />
              </button>
            }
          />
          <PopoverContent
            align="start"
            side="top"
            sideOffset={6}
            className="w-72 gap-0 p-0"
          >
            <div className="px-2 pt-2 pb-1">
              {/* Soft pill search — shared look with skills / connectors flyouts. */}
              <div className="flex h-8 items-center gap-1.5 rounded-lg border border-dls-border/50 bg-dls-surface-muted px-2.5">
                <Search className="size-3.5 shrink-0 text-dls-secondary" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("session.workspace_search_placeholder")}
                  className="h-7 border-0 bg-transparent p-0 text-sm leading-5 text-dls-text shadow-none placeholder:text-dls-secondary/70 focus-visible:ring-0"
                />
              </div>
            </div>

            <div className="max-h-52 overflow-y-auto px-1.5 pb-1.5 pt-0">
              {filtered.length === 0 ? (
                <div className="px-2.5 py-2.5 text-center text-xs leading-5 text-dls-secondary whitespace-nowrap">
                  {knownWorkspaces.length === 0
                    ? t("session.workspace_recent_empty")
                    : t("session.workspace_recent_no_match")}
                </div>
              ) : (
                filtered.map((path) => {
                  const active = path === trimmedRoot;
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => handleSelect(path)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm leading-5 transition-colors",
                        "hover:bg-dls-surface-muted/70",
                        active && "bg-dls-surface-muted text-dls-text",
                      )}
                      title={path}
                    >
                      <Folder className="size-3.5 shrink-0 text-dls-secondary" />
                      <span className="min-w-0 flex-1 truncate">
                        {workspaceDisplayName(path)}
                      </span>
                      {active ? (
                        <Check className="size-3.5 shrink-0 text-dls-secondary" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t border-dls-border p-1.5">
              <button
                type="button"
                onClick={openCreateDialog}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm leading-5 transition-colors hover:bg-dls-surface-muted/70"
              >
                <Plus className="size-3.5 shrink-0 text-dls-secondary" />
                <span>{t("session.workspace_create_new")}</span>
              </button>
              <button
                type="button"
                onClick={() => void browseLocal()}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm leading-5 transition-colors hover:bg-dls-surface-muted/70"
              >
                <FolderPlus className="size-3.5 shrink-0 text-dls-secondary" />
                <span>{t("session.workspace_open_local")}</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {trimmedRoot ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleClear}
            className="size-6 rounded-full text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            title={t("session.clear_workspace_selection")}
            aria-label={t("session.clear_workspace_selection")}
          >
            <X className="size-3" />
          </Button>
        ) : null}
      </div>
      <AccessPermissionSelect
        value={props.accessMode}
        onChange={props.onAccessModeChange}
        density="compact"
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="gap-4 bg-dls-surface sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {t("session.workspace_create_new")}
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              {t("session.workspace_create_desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              autoFocus
              value={createName}
              onChange={(event) => {
                setCreateName(event.target.value);
                if (createError) setCreateError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitCreate();
                }
              }}
              placeholder={t("session.workspace_create_placeholder")}
              disabled={createBusy}
              className="h-9"
            />
            {createError ? (
              <p className="text-xs text-dls-status-danger-fg">{createError}</p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={createBusy}
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={createBusy || !sanitizeDraftSpaceName(createName)}
              onClick={() => void submitCreate()}
            >
              {createBusy ? <LoadingSpinner size="sm" className="mr-1.5" /> : null}
              {t("session.workspace_create_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
