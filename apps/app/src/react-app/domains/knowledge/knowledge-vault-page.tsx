/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronsDown,
  ChevronsUp,
  FilePlus,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { KNOWLEDGE_BASE_PLACEHOLDER_ASSET } from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { t } from "../../../i18n";
import { isElectronRuntime } from "../../../app/utils";
import {
  deleteKnowledgeVaultFile,
  getKnowledgeVaultConfig,
  listKnowledgeVault,
  openKnowledgeVaultFolder,
  rebuildKnowledgeVaultIndex,
  readKnowledgeVaultFile,
  revealDesktopItemInDir,
  searchKnowledgeVault,
  writeKnowledgeVaultFile,
} from "../../../app/lib/desktop";
import { KnowledgeVaultReader } from "./knowledge-vault-reader";
import { KnowledgeVaultSplitEditor } from "./knowledge-vault-split-editor";
import { subscribeOpenKnowledgeNote, takePendingKnowledgeNote } from "./knowledge-vault-navigation";
import {
  applyKnowledgeNoteProps,
  countFilledKnowledgeProps,
  countKnowledgeBody,
  parseKnowledgeNoteProps,
  splitMarkdownFrontmatter,
} from "./knowledge-vault-frontmatter";
import { KnowledgeVaultProperties } from "./knowledge-vault-properties";
import { KnowledgeVaultSwitcher, type KnowledgeVaultOption } from "./knowledge-vault-switcher";
import { KnowledgeVaultTabBar } from "./knowledge-vault-tab-bar";
import {
  activateOrReuseTab,
  addKnowledgeEditorTab,
  closeKnowledgeEditorTab,
  createKnowledgeEditorTab,
} from "./knowledge-vault-tabs";
import { KnowledgeVaultTree } from "./knowledge-vault-tree";
import {
  canDropKnowledgeItem,
  defaultKnowledgeNote,
  filesForScope,
  filterKnowledgeFiles,
  knowledgeFileLanguage,
  joinKnowledgeRelPath,
  knowledgeHitKey,
  nextDuplicateRelPath,
  normalizeKnowledgeFolderName,
  normalizeNoteFileName,
  normalizeNewNoteRelPath,
  rewriteFolderPrefix,
  suggestKnowledgeNoteName,
  type KnowledgeNoteRef,
  type KnowledgeVaultScope,
  type KnowledgeVaultScopeList,
} from "./knowledge-vault-model";
import { createKnowledgeEditorSession } from "./knowledge-vault-editor-session";
import { readKnowledgeFavorites, toggleKnowledgeFavorite } from "./knowledge-vault-favorites";
import type { KnowledgeContextTarget } from "./knowledge-vault-context-menu";

type KnowledgeVaultPageProps = {
  workspaceId?: string | null;
  expertId?: string | null;
};

type SaveState = "saved" | "saving" | "unsaved" | "error";

export function KnowledgeVaultPage(props: KnowledgeVaultPageProps) {
  const desktop = isElectronRuntime();
  const workspaceId = props.workspaceId?.trim() || undefined;
  const expertId = props.expertId?.trim() || undefined;
  const [scope, setScope] = useState<KnowledgeVaultScope>("user");
  const [scopes, setScopes] = useState<KnowledgeVaultScopeList[]>([]);
  const [selected, setSelected] = useState<KnowledgeNoteRef | null>(null);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState("");
  const [query, setQuery] = useState("");
  const [hitPaths, setHitPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeContextTarget | null>(null);
  const [createFolderPrefix, setCreateFolderPrefix] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<KnowledgeContextTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<KnowledgeContextTarget | null>(null);
  const [moveValue, setMoveValue] = useState("");
  const [vaultLabel, setVaultLabel] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [vaults, setVaults] = useState<KnowledgeVaultOption[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(() => readKnowledgeFavorites());
  const [expandNonce, setExpandNonce] = useState(0);
  const [collapseNonce, setCollapseNonce] = useState(0);
  const [editorMode, setEditorMode] = useState<"view" | "edit">("view");
  const [editLayout, setEditLayout] = useState<"source" | "split">("split");
  const [indexing, setIndexing] = useState(false);
  const [tabs, setTabs] = useState(() => [createKnowledgeEditorTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");
  const editorSessionRef = useRef(createKnowledgeEditorSession());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

  const visibleFiles = useMemo(
    () =>
      filterKnowledgeFiles(
        filesForScope(scopes, scope).filter((file) => file.indexable),
        query,
        hitPaths,
        scope,
      ),
    [scopes, scope, query, hitPaths],
  );

  const refresh = useCallback(async () => {
    if (!desktop) {
      setLoading(false);
      return;
    }
    const listed = await listKnowledgeVault({
      scope: "all",
      workspaceId,
      expertId,
    });
    if (!listed?.ok) {
      setError(t("knowledge.load_error"));
      setLoading(false);
      return;
    }
    setScopes(listed.scopes as KnowledgeVaultScopeList[]);
    const userPath = listed.scopes.find((item) => item.scope === "user")?.path;
    const config = await getKnowledgeVaultConfig();
    if (config?.ok) {
      setVaults(config.vaults ?? []);
      setVaultPath(config.resolvedUserVaultDir);
      const active = (config.vaults ?? []).find(
        (item) => item.path === config.resolvedUserVaultDir,
      );
      setVaultLabel(active?.name || userPath?.split(/[\\/]/).filter(Boolean).pop() || "");
    } else if (userPath) {
      setVaultPath(userPath);
      setVaultLabel(userPath.split(/[\\/]/).filter(Boolean).pop() || "");
    }
    setLoading(false);
    return listed.scopes as KnowledgeVaultScopeList[];
  }, [desktop, expertId, workspaceId]);

  const openNote = useCallback(
    async (note: KnowledgeNoteRef) => {
      if (!desktop) return;
      const session = editorSessionRef.current;
      session.setDraft(draft);
      const { gen, flush } = session.startOpen(note);
      if (flush) {
        await writeKnowledgeVaultFile({
          scope: flush.note.scope,
          relPath: flush.note.relPath,
          content: flush.content,
          workspaceId,
          expertId,
        });
      }
      setSelected(note);
      setDraft("");
      setLoaded("");
      setSaveState("saved");
      setEditorMode("view");
      setError(null);
      const result = await readKnowledgeVaultFile({
        scope: note.scope,
        relPath: note.relPath,
        workspaceId,
        expertId,
      });
      const applied = session.applyOpenResult(gen, result ?? { ok: false });
      if (!applied.applied) {
        if (applied.reason === "read_failed") {
          setError(
            result?.reason === "unsupported_type"
              ? t("knowledge.unsupported_file")
              : t("knowledge.load_error"),
          );
          setDraft("");
          setLoaded("");
        }
        return;
      }
      const content = result?.content ?? "";
      setDraft(content);
      setLoaded(content);
      setSaveState("saved");
      const next = activateOrReuseTab(tabsRef.current, activeTabIdRef.current, note, content);
      setTabs(next.tabs);
      setActiveTabId(next.activeId);
    },
    [desktop, draft, expertId, workspaceId],
  );

  useEffect(
    () =>
      subscribeOpenKnowledgeNote((note) => {
        void openNote(note);
      }),
    [openNote],
  );

  const handleRebuildIndex = useCallback(async () => {
    setIndexing(true);
    setError(null);
    try {
      const result = await rebuildKnowledgeVaultIndex({
        scope: "all",
        workspaceId,
        expertId,
      });
      if (!result?.ok) {
        const reason = String(result?.reason ?? "");
        setError(
          /not declared|not implemented/i.test(reason)
            ? t("knowledge.index_restart")
            : t("knowledge.index_error"),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(
        /not declared|not implemented/i.test(message)
          ? t("knowledge.index_restart")
          : t("knowledge.index_error"),
      );
    } finally {
      setIndexing(false);
    }
  }, [expertId, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await refresh();
      if (cancelled || !next) return;
      const pending = takePendingKnowledgeNote();
      const initial = pending ?? defaultKnowledgeNote(next);
      if (!initial || !desktop) return;
      const session = editorSessionRef.current;
      const { gen } = session.startOpen(initial);
      setSelected(initial);
      const result = await readKnowledgeVaultFile({
        scope: initial.scope,
        relPath: initial.relPath,
        workspaceId,
        expertId,
      });
      if (cancelled) return;
      const applied = session.applyOpenResult(gen, result ?? { ok: false });
      if (!applied.applied) {
        if (applied.reason === "read_failed") setError(t("knowledge.load_error"));
        return;
      }
      setDraft(result?.content ?? "");
      setLoaded(result?.content ?? "");
      setSaveState("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop, expertId, refresh, workspaceId]);

  useEffect(() => {
    if (scope === "project" && !workspaceId) setScope("user");
    if (scope === "expert" && !expertId) setScope("user");
  }, [expertId, scope, workspaceId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!desktop || !trimmed) {
      setHitPaths(new Set());
      return;
    }
    const handle = window.setTimeout(() => {
      void searchKnowledgeVault({
        query: trimmed,
        scope,
        workspaceId,
        expertId,
      }).then((result) => {
        setHitPaths(
          new Set(
            (result?.hits ?? []).map((hit) =>
              knowledgeHitKey(
                hit.scope === "project" || hit.scope === "expert" ? hit.scope : "user",
                hit.relPath,
              ),
            ),
          ),
        );
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [desktop, expertId, query, scope, workspaceId]);

  useEffect(() => {
    const session = editorSessionRef.current;
    session.setDraft(draft);
    const token = session.beginAutosave();
    if (!token) return;
    setSaveState("unsaved");
    const handle = window.setTimeout(() => {
      setSaveState("saving");
      void writeKnowledgeVaultFile({
        scope: token.note.scope,
        relPath: token.note.relPath,
        content: token.content,
        workspaceId,
        expertId,
      }).then((result) => {
        const applied = session.applyAutosaveLoaded(token);
        if (!applied.applied) return;
        if (!result?.ok) {
          setSaveState("error");
          setError(t("knowledge.save_error"));
          return;
        }
        setLoaded(token.content);
        setSaveState("saved");
        setError(null);
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [draft, expertId, loaded, selected, workspaceId]);

  useEffect(() => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId ? { ...tab, note: selected, draft, loaded } : tab,
      ),
    );
  }, [activeTabId, draft, loaded, selected]);

  const applyTab = (nextTabs: typeof tabs, nextId: string) => {
    const next = nextTabs.find((tab) => tab.id === nextId) ?? nextTabs[0];
    setTabs(nextTabs);
    setActiveTabId(nextId);
    setSelected(next?.note ?? null);
    setDraft(next?.draft ?? "");
    setLoaded(next?.loaded ?? "");
    setSaveState(next && next.draft !== next.loaded ? "unsaved" : "saved");
    if (next?.note) setEditorMode("view");
  };

  const persistActiveTab = () =>
    tabs.map((tab) => (tab.id === activeTabId ? { ...tab, note: selected, draft, loaded } : tab));

  const vaultRoot = useMemo(
    () => scopes.find((item) => item.scope === scope)?.path ?? "",
    [scope, scopes],
  );

  const existingPaths = useMemo(
    () => new Set(filesForScope(scopes, scope).map((file) => file.relPath)),
    [scope, scopes],
  );

  const footerStats = useMemo(() => {
    if (!selected) return { propCount: 0, words: 0, chars: 0 };
    const parsed = parseKnowledgeNoteProps(draft);
    const counted = countKnowledgeBody(splitMarkdownFrontmatter(draft).body);
    return {
      propCount: countFilledKnowledgeProps(parsed),
      words: counted.words,
      chars: counted.chars,
    };
  }, [draft, selected]);

  const handleCreate = async () => {
    const name = normalizeNewNoteRelPath(createName || suggestKnowledgeNoteName());
    if (!name) {
      setError(t("knowledge.note_name_invalid"));
      return;
    }
    const relPath = joinKnowledgeRelPath(createFolderPrefix, name);
    const result = await writeKnowledgeVaultFile({
      scope,
      relPath,
      content: `# ${name.replace(/\.(md|txt|csv)$/i, "")}\n\n`,
      workspaceId,
      expertId,
    });
    if (!result?.ok) {
      setError(t("knowledge.save_error"));
      return;
    }
    setCreateOpen(false);
    setCreateName("");
    const next = await refresh();
    await openNote({ scope, relPath });
    setEditorMode("edit");
    if (next) setScopes(next);
  };

  const handleCreateFolder = async () => {
    const name = normalizeKnowledgeFolderName(folderName);
    if (!name) {
      setError(t("knowledge.note_name_invalid"));
      return;
    }
    const relPath = joinKnowledgeRelPath(
      createFolderPrefix,
      `${name}/${suggestKnowledgeNoteName()}`,
    );
    const result = await writeKnowledgeVaultFile({
      scope,
      relPath,
      content: `# ${name}\n\n`,
      workspaceId,
      expertId,
    });
    if (!result?.ok) {
      setError(t("knowledge.save_error"));
      return;
    }
    setFolderOpen(false);
    setFolderName("");
    const next = await refresh();
    await openNote({ scope, relPath });
    setEditorMode("edit");
    if (next) setScopes(next);
  };

  const handleDelete = async () => {
    const target = deleteTarget;
    setDeleteOpen(false);
    setDeleteTarget(null);
    if (!target || target.kind === "root") return;
    const files = filesForScope(scopes, scope);
    const toDelete =
      target.kind === "file"
        ? [target.relPath]
        : files
            .map((file) => file.relPath)
            .filter((relPath) => relPath === target.path || relPath.startsWith(`${target.path}/`));
    for (const relPath of toDelete) {
      const result = await deleteKnowledgeVaultFile({
        scope,
        relPath,
        workspaceId,
        expertId,
      });
      if (!result?.ok && result?.reason !== "protected") {
        setError(t("knowledge.delete_error"));
        return;
      }
    }
    const next = (await refresh()) ?? [];
    const fallback = defaultKnowledgeNote(next);
    if (fallback) await openNote(fallback);
    else {
      setSelected(null);
      setDraft("");
      setLoaded("");
    }
  };

  const handleDuplicate = async (relPath: string) => {
    const source = await readKnowledgeVaultFile({
      scope,
      relPath,
      workspaceId,
      expertId,
    });
    if (!source?.ok || typeof source.content !== "string") {
      setError(t("knowledge.load_error"));
      return;
    }
    const dest = nextDuplicateRelPath(relPath, existingPaths);
    const written = await writeKnowledgeVaultFile({
      scope,
      relPath: dest,
      content: source.content,
      workspaceId,
      expertId,
    });
    if (!written?.ok) {
      setError(t("knowledge.save_error"));
      return;
    }
    const next = await refresh();
    if (next) setScopes(next);
    await openNote({ scope, relPath: dest });
  };

  const handleRename = async () => {
    if (!renameTarget || renameTarget.kind === "root") return;
    const files = filesForScope(scopes, scope);
    if (renameTarget.kind === "file") {
      const name = normalizeNoteFileName(renameValue);
      if (!name) {
        setError(t("knowledge.note_name_invalid"));
        return;
      }
      const dest = joinKnowledgeRelPath(
        renameTarget.relPath.includes("/")
          ? renameTarget.relPath.slice(0, renameTarget.relPath.lastIndexOf("/"))
          : "",
        name,
      );
      const source = await readKnowledgeVaultFile({
        scope,
        relPath: renameTarget.relPath,
        workspaceId,
        expertId,
      });
      if (!source?.ok || typeof source.content !== "string") {
        setError(t("knowledge.load_error"));
        return;
      }
      const written = await writeKnowledgeVaultFile({
        scope,
        relPath: dest,
        content: source.content,
        workspaceId,
        expertId,
      });
      if (!written?.ok) {
        setError(t("knowledge.save_error"));
        return;
      }
      await deleteKnowledgeVaultFile({
        scope,
        relPath: renameTarget.relPath,
        workspaceId,
        expertId,
      });
      setRenameOpen(false);
      const next = await refresh();
      if (next) setScopes(next);
      await openNote({ scope, relPath: dest });
      return;
    }
    const name = normalizeKnowledgeFolderName(renameValue);
    if (!name) {
      setError(t("knowledge.note_name_invalid"));
      return;
    }
    const parent = renameTarget.path.includes("/")
      ? renameTarget.path.slice(0, renameTarget.path.lastIndexOf("/"))
      : "";
    const destFolder = joinKnowledgeRelPath(parent, name);
    for (const file of files) {
      const nextPath = rewriteFolderPrefix(file.relPath, renameTarget.path, destFolder);
      if (!nextPath || nextPath === file.relPath) continue;
      const source = await readKnowledgeVaultFile({
        scope,
        relPath: file.relPath,
        workspaceId,
        expertId,
      });
      if (!source?.ok || typeof source.content !== "string") continue;
      await writeKnowledgeVaultFile({
        scope,
        relPath: nextPath,
        content: source.content,
        workspaceId,
        expertId,
      });
      await deleteKnowledgeVaultFile({
        scope,
        relPath: file.relPath,
        workspaceId,
        expertId,
      });
    }
    setRenameOpen(false);
    const next = await refresh();
    if (next) setScopes(next);
  };

  const handleMove = async () => {
    if (!moveTarget || moveTarget.kind === "root") return;
    const destFolder =
      normalizeKnowledgeFolderName(moveValue) ?? moveValue.trim().replace(/^\/+|\/+$/g, "");
    if (destFolder.includes("..")) {
      setError(t("knowledge.note_name_invalid"));
      return;
    }
    const files = filesForScope(scopes, scope);
    if (moveTarget.kind === "file") {
      const name = moveTarget.relPath.split("/").pop() ?? moveTarget.relPath;
      const dest = joinKnowledgeRelPath(destFolder, name);
      const source = await readKnowledgeVaultFile({
        scope,
        relPath: moveTarget.relPath,
        workspaceId,
        expertId,
      });
      if (!source?.ok || typeof source.content !== "string") {
        setError(t("knowledge.load_error"));
        return;
      }
      await writeKnowledgeVaultFile({
        scope,
        relPath: dest,
        content: source.content,
        workspaceId,
        expertId,
      });
      await deleteKnowledgeVaultFile({
        scope,
        relPath: moveTarget.relPath,
        workspaceId,
        expertId,
      });
      setMoveOpen(false);
      const next = await refresh();
      if (next) setScopes(next);
      await openNote({ scope, relPath: dest });
      return;
    }
    const dest = destFolder;
    for (const file of files) {
      const nextPath = rewriteFolderPrefix(
        file.relPath,
        moveTarget.path,
        joinKnowledgeRelPath(dest, moveTarget.path.split("/").pop() ?? moveTarget.path),
      );
      if (!nextPath || nextPath === file.relPath) continue;
      const source = await readKnowledgeVaultFile({
        scope,
        relPath: file.relPath,
        workspaceId,
        expertId,
      });
      if (!source?.ok || typeof source.content !== "string") continue;
      await writeKnowledgeVaultFile({
        scope,
        relPath: nextPath,
        content: source.content,
        workspaceId,
        expertId,
      });
      await deleteKnowledgeVaultFile({
        scope,
        relPath: file.relPath,
        workspaceId,
        expertId,
      });
    }
    setMoveOpen(false);
    const next = await refresh();
    if (next) setScopes(next);
  };

  const resolveAbsPath = (target: KnowledgeContextTarget) => {
    const rel = target.kind === "file" ? target.relPath : target.kind === "dir" ? target.path : "";
    if (!vaultRoot) return rel;
    if (!rel) return vaultRoot;
    return `${vaultRoot.replace(/[\\/]+$/, "")}/${rel}`;
  };

  const treeActions = {
    favorites,
    onNewNote: (folder: string) => {
      setCreateFolderPrefix(folder);
      setCreateName(suggestKnowledgeNoteName());
      setCreateOpen(true);
    },
    onNewFolder: (folder: string) => {
      setCreateFolderPrefix(folder);
      setFolderName("");
      setFolderOpen(true);
    },
    onDuplicate: (relPath: string) => void handleDuplicate(relPath),
    onMove: (target: KnowledgeContextTarget) => {
      setMoveTarget(target);
      setMoveValue("");
      setMoveOpen(true);
    },
    onSearchInFolder: (folder: string) => setQuery(folder),
    onFavorite: (target: KnowledgeContextTarget) => {
      const key =
        target.kind === "file"
          ? `${scope}:${target.relPath}`
          : target.kind === "dir"
            ? `dir:${target.path}`
            : "";
      if (!key) return;
      setFavorites(toggleKnowledgeFavorite(key));
    },
    onCopyPath: (target: KnowledgeContextTarget, which: "rel" | "abs") => {
      const rel =
        target.kind === "file" ? target.relPath : target.kind === "dir" ? target.path : ".";
      void navigator.clipboard.writeText(which === "abs" ? resolveAbsPath(target) : rel);
    },
    onReveal: (target: KnowledgeContextTarget) => {
      void revealDesktopItemInDir(resolveAbsPath(target), vaultRoot || undefined);
    },
    onRename: (target: KnowledgeContextTarget) => {
      setRenameTarget(target);
      setRenameValue(
        target.kind === "file"
          ? (target.relPath.split("/").pop() ?? target.relPath)
          : target.kind === "dir"
            ? (target.path.split("/").pop() ?? target.path)
            : "",
      );
      setRenameOpen(true);
    },
    onDelete: (target: KnowledgeContextTarget) => {
      setDeleteTarget(target);
      setDeleteOpen(true);
    },
    onDropMove: (source: { kind: "file" | "dir"; path: string }, destFolder: string) => {
      void (async () => {
        if (!canDropKnowledgeItem(source, destFolder)) return;
        const files = filesForScope(scopes, scope);
        if (source.kind === "file") {
          const name = source.path.split("/").pop() ?? source.path;
          const dest = joinKnowledgeRelPath(destFolder, name);
          const body = await readKnowledgeVaultFile({
            scope,
            relPath: source.path,
            workspaceId,
            expertId,
          });
          if (!body?.ok || typeof body.content !== "string") {
            setError(t("knowledge.load_error"));
            return;
          }
          const written = await writeKnowledgeVaultFile({
            scope,
            relPath: dest,
            content: body.content,
            workspaceId,
            expertId,
          });
          if (!written?.ok) {
            setError(t("knowledge.save_error"));
            return;
          }
          await deleteKnowledgeVaultFile({
            scope,
            relPath: source.path,
            workspaceId,
            expertId,
          });
          const next = await refresh();
          if (next) setScopes(next);
          await openNote({ scope, relPath: dest });
          return;
        }
        const destRoot = joinKnowledgeRelPath(
          destFolder,
          source.path.split("/").pop() ?? source.path,
        );
        for (const file of files) {
          const nextPath = rewriteFolderPrefix(file.relPath, source.path, destRoot);
          if (!nextPath || nextPath === file.relPath) continue;
          const body = await readKnowledgeVaultFile({
            scope,
            relPath: file.relPath,
            workspaceId,
            expertId,
          });
          if (!body?.ok || typeof body.content !== "string") continue;
          await writeKnowledgeVaultFile({
            scope,
            relPath: nextPath,
            content: body.content,
            workspaceId,
            expertId,
          });
          await deleteKnowledgeVaultFile({
            scope,
            relPath: file.relPath,
            workspaceId,
            expertId,
          });
        }
        const next = await refresh();
        if (next) setScopes(next);
      })();
    },
  };

  if (!desktop) {
    return (
      <div className="flex h-full items-center justify-center bg-dls-background px-6">
        <NoticeBox tone="info" size="comfortable">
          {t("knowledge.desktop_only")}
        </NoticeBox>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background">
      <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
        <div className="flex h-10 items-center border-b border-r border-dls-border px-1.5 mac:titlebar-no-drag">
          <InputGroup controlSize="sm">
            <InputGroupAddon>
              <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("knowledge.search_placeholder")}
            />
          </InputGroup>
        </div>
        <div className="flex h-10 min-w-0 border-b border-dls-border">
          <KnowledgeVaultTabBar
            tabs={tabs}
            activeId={activeTabId}
            onActivate={(id) => applyTab(persistActiveTab(), id)}
            onClose={(id) => {
              const next = closeKnowledgeEditorTab(persistActiveTab(), id);
              applyTab(next.tabs, next.activeId);
            }}
            onAdd={() => {
              const next = addKnowledgeEditorTab(persistActiveTab());
              applyTab(next.tabs, next.activeId);
            }}
            mode={editorMode}
            onModeChange={setEditorMode}
          />
        </div>
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-dls-border">
          <div className="flex h-10 shrink-0 items-center justify-center gap-0.5 px-1.5 text-dls-secondary mac:titlebar-no-drag">
            <ToolbarIconButton
              label={t("knowledge.new_note")}
              hint={t("knowledge.toolbar_new_note")}
              onClick={() => {
                setCreateFolderPrefix("");
                setCreateName(suggestKnowledgeNoteName());
                setCreateOpen(true);
              }}
            >
              <FilePlus className="size-3.5" strokeWidth={1.75} />
            </ToolbarIconButton>
            <ToolbarIconButton
              label={t("knowledge.new_folder")}
              hint={t("knowledge.toolbar_new_folder")}
              onClick={() => {
                setCreateFolderPrefix("");
                setFolderOpen(true);
              }}
            >
              <FolderPlus className="size-3.5" strokeWidth={1.75} />
            </ToolbarIconButton>
            <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
            <ToolbarIconButton
              label={t("knowledge.open_folder")}
              hint={t("knowledge.toolbar_open_folder")}
              onClick={() => void openKnowledgeVaultFolder()}
            >
              <FolderOpen className="size-3.5" strokeWidth={1.75} />
            </ToolbarIconButton>
            <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
            <ToolbarIconButton
              label={t("knowledge.expand_all")}
              hint={t("knowledge.toolbar_expand_all")}
              onClick={() => setExpandNonce((value) => value + 1)}
            >
              <ChevronsDown className="size-3.5" strokeWidth={1.75} />
            </ToolbarIconButton>
            <ToolbarIconButton
              label={t("knowledge.collapse_all")}
              hint={t("knowledge.toolbar_collapse_all")}
              onClick={() => setCollapseNonce((value) => value + 1)}
            >
              <ChevronsUp className="size-3.5" strokeWidth={1.75} />
            </ToolbarIconButton>
            <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
            <ToolbarIconButton
              label={t("knowledge.sync_index")}
              hint={t("knowledge.toolbar_sync_index")}
              disabled={indexing}
              onClick={() => void handleRebuildIndex()}
            >
              <RefreshCw
                className={`size-3.5 ${indexing ? "animate-spin" : ""}`}
                strokeWidth={1.75}
              />
            </ToolbarIconButton>
          </div>
          {error ? (
            <div className="px-2 pt-2">
              <NoticeBox tone="error">{error}</NoticeBox>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : visibleFiles.length === 0 && query.trim() ? (
              <div className="px-3 py-8 text-center text-sm text-dls-secondary">
                {t("knowledge.no_results")}
              </div>
            ) : (
              <KnowledgeVaultTree
                files={visibleFiles}
                scope={scope}
                selected={selected}
                onSelect={(note) => void openNote(note)}
                actions={treeActions}
                expandNonce={expandNonce}
                collapseNonce={collapseNonce}
              />
            )}
          </div>
        </aside>
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {selected ? (
            editorMode === "edit" ? (
              <>
                <KnowledgeVaultProperties
                  value={parseKnowledgeNoteProps(draft)}
                  onChange={(props) => setDraft(applyKnowledgeNoteProps(draft, props))}
                />
                <KnowledgeVaultSplitEditor
                  value={splitMarkdownFrontmatter(draft).body}
                  language={knowledgeFileLanguage(selected.relPath)}
                  onChange={(body) =>
                    setDraft(applyKnowledgeNoteProps(body, parseKnowledgeNoteProps(draft)))
                  }
                  layout={editLayout}
                  onLayoutChange={setEditLayout}
                />
              </>
            ) : (
              <KnowledgeVaultReader
                markdown={draft}
                relPath={selected.relPath}
                vaultLabel={vaultLabel || t("knowledge.default_vault")}
                onEdit={() => setEditorMode("edit")}
              />
            )
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="flex max-w-sm flex-col items-center">
                <EmptyStateIllustration src={KNOWLEDGE_BASE_PLACEHOLDER_ASSET} />
                <div className="space-y-1.5">
                  <div className="text-base font-medium text-dls-text">
                    {filesForScope(scopes, scope).length === 0
                      ? t("knowledge.empty_title")
                      : t("knowledge.empty_tab")}
                  </div>
                  <p className="text-sm text-dls-secondary">
                    {filesForScope(scopes, scope).length === 0
                      ? t("knowledge.empty_body")
                      : t("knowledge.empty_tab_body")}
                  </p>
                </div>
                <Button
                  className="mt-5"
                  onClick={() => {
                    setCreateFolderPrefix("");
                    setCreateName(suggestKnowledgeNoteName());
                    setCreateOpen(true);
                  }}
                >
                  {t("knowledge.tab_create")}
                </Button>
              </div>
            </div>
          )}
        </section>
        <div className="flex h-10 items-center justify-between gap-1 border-r border-t border-dls-border px-1">
          <KnowledgeVaultSwitcher
            currentPath={vaultPath}
            vaults={
              vaults.length > 0
                ? vaults
                : [
                    {
                      name: vaultLabel || t("knowledge.default_vault"),
                      path: vaultPath,
                      isDefault: true,
                    },
                  ]
            }
            onChanged={() => {
              void (async () => {
                const empty = createKnowledgeEditorTab();
                setTabs([empty]);
                setActiveTabId(empty.id);
                const next = await refresh();
                if (!next) return;
                const initial = defaultKnowledgeNote(next);
                if (initial) await openNote(initial);
                else {
                  setSelected(null);
                  setDraft("");
                  setLoaded("");
                }
              })();
            }}
          />
          {saveState === "saved" ? null : (
            <span className="shrink-0 px-1 text-xs text-dls-secondary">
              {saveState === "saving"
                ? t("knowledge.saving")
                : saveState === "unsaved"
                  ? t("knowledge.unsaved")
                  : t("knowledge.save_error")}
            </span>
          )}
        </div>
        <div className="flex h-10 items-center justify-end gap-3 border-t border-dls-border px-3 text-xs text-dls-secondary">
          <span>{t("knowledge.stat_props", { count: footerStats.propCount })}</span>
          <span>{t("knowledge.stat_words", { count: footerStats.words })}</span>
          <span>{t("knowledge.stat_chars", { count: footerStats.chars })}</span>
        </div>
      </div>

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("knowledge.new_folder_title")}</DialogTitle>
            <DialogDescription>{t("knowledge.new_note_hint")}</DialogDescription>
          </DialogHeader>
          <Input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder={t("knowledge.new_folder_placeholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleCreateFolder()}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("knowledge.new_note_title")}</DialogTitle>
            <DialogDescription>{t("knowledge.new_note_hint")}</DialogDescription>
          </DialogHeader>
          <Input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder={t("knowledge.new_note_placeholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleCreate()}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("knowledge.rename_title")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder={t("knowledge.rename_placeholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleRename()}>{t("knowledge.rename")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("knowledge.move_to_title")}</DialogTitle>
          </DialogHeader>
          <Input
            value={moveValue}
            onChange={(event) => setMoveValue(event.target.value)}
            placeholder={t("knowledge.move_to_placeholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleMove()}>{t("knowledge.move_to")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={deleteOpen}
        title={t("knowledge.delete_title")}
        message={t("knowledge.delete_confirm", {
          name:
            deleteTarget?.kind === "file"
              ? deleteTarget.relPath
              : deleteTarget?.kind === "dir"
                ? deleteTarget.path
                : (selected?.relPath ?? ""),
        })}
        confirmLabel={t("knowledge.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

function ToolbarIconButton(props: {
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-dls-secondary hover:text-dls-text"
            disabled={props.disabled}
            onClick={props.onClick}
            aria-label={props.label}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-56">
        {props.hint}
      </TooltipContent>
    </Tooltip>
  );
}
