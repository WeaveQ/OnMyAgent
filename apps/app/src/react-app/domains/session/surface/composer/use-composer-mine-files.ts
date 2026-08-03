/**
 * Composer + menu → Mine (uploads/) folder browser with multi-level nav + search.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import fuzzysort from "fuzzysort";
import type { ComposerMentionTarget } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { WORKSPACE_UPLOADS_DIR } from "../../../workspace";
import type { MentionItem } from "./composer-helpers";

const MINE_ROOT = WORKSPACE_UPLOADS_DIR;

export type UseComposerMineFilesInput = {
  open: boolean;
  listFolderFiles: (path: string) => Promise<ComposerMentionTarget[]>;
  searchFiles: (query: string) => Promise<ComposerMentionTarget[]>;
  loadWorkspaceFiles: (paths: string[]) => Promise<File[]>;
  addAttachments: (files: File[]) => Promise<number>;
  onAdded?: () => void;
};

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function isUnderMine(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return (
    normalized === MINE_ROOT || normalized.startsWith(`${MINE_ROOT}/`)
  );
}

function toItems(targets: ComposerMentionTarget[]): MentionItem[] {
  return targets.map((target) => ({
    id: `${target.kind}:${target.path}`,
    kind: target.kind,
    value: target.path,
    label: target.label?.trim() || basename(target.path),
    subtitle: target.subtitle?.trim() || undefined,
  }));
}

function folderTitle(path: string): string {
  if (path === MINE_ROOT) return t("files.source_uploads");
  return basename(path);
}

export function useComposerMineFiles(input: UseComposerMineFilesInput) {
  const [folderPath, setFolderPath] = useState(MINE_ROOT);
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState<MentionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (input.open) return;
    setFolderPath(MINE_ROOT);
    setSearchQuery("");
    setItems([]);
    setLoading(false);
    setAdding(false);
    setError(null);
    setSelectedFilePaths(new Set());
  }, [input.open]);

  useEffect(() => {
    if (!input.open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = searchQuery.trim();

    const load = async () => {
      if (query) {
        const targets = await input.searchFiles(query);
        // Include folders so search can jump into nested Mine paths.
        const mineOnly = targets.filter(
          (target) => isUnderMine(target.path) && target.path !== MINE_ROOT,
        );
        return toItems(mineOnly);
      }
      const targets = await input.listFolderFiles(folderPath);
      return toItems(targets.filter((target) => isUnderMine(target.path)));
    };

    void load()
      .then((next) => {
        if (!cancelled) setItems(next);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setError(t("composer.folder_files_failed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    folderPath,
    input.listFolderFiles,
    input.open,
    input.searchFiles,
    searchQuery,
  ]);

  const displayItems = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return items;
    // searchFiles already filtered; light local refine on label/path.
    return fuzzysort
      .go(query, items, { keys: ["label", "value", "subtitle"], limit: 80 })
      .map((entry) => entry.obj);
  }, [items, searchQuery]);

  const openFolder = useCallback((path: string) => {
    if (!isUnderMine(path)) return;
    setSearchQuery("");
    setFolderPath(path);
    setSelectedFilePaths(new Set());
    setError(null);
  }, []);

  const backFolder = useCallback(() => {
    if (folderPath === MINE_ROOT) return;
    const parent = folderPath
      .split("/")
      .filter(Boolean)
      .slice(0, -1)
      .join("/");
    setFolderPath(parent || MINE_ROOT);
    setSelectedFilePaths(new Set());
    setError(null);
  }, [folderPath]);

  const toggleFile = useCallback((path: string) => {
    setError(null);
    setSelectedFilePaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const addSelectedFiles = useCallback(async () => {
    const paths = Array.from(selectedFilePaths);
    if (!paths.length || adding) return false;
    setAdding(true);
    setError(null);
    try {
      const files = await input.loadWorkspaceFiles(paths);
      if (!files.length) {
        setError(t("composer.folder_files_failed"));
        return false;
      }
      const added = await input.addAttachments(files);
      if (!(added > 0)) return false;
      setSelectedFilePaths(new Set());
      input.onAdded?.();
      return true;
    } catch {
      setError(t("composer.folder_files_failed"));
      return false;
    } finally {
      setAdding(false);
    }
  }, [adding, input, selectedFilePaths]);

  const canGoBack = folderPath !== MINE_ROOT && !searchQuery.trim();
  const title = searchQuery.trim()
    ? t("files.source_uploads")
    : folderTitle(folderPath);

  return {
    rootPath: MINE_ROOT,
    folderPath,
    searchQuery,
    setSearchQuery,
    items: displayItems,
    loading,
    adding,
    error,
    selectedFilePaths,
    canGoBack,
    title,
    openFolder,
    backFolder,
    toggleFile,
    addSelectedFiles,
  };
}
