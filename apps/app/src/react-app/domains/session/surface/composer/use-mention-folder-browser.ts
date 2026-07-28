import { useEffect, useMemo, useState } from "react";
import fuzzysort from "fuzzysort";
import type { ComposerMentionTarget } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import type { MentionItem } from "./composer-helpers";

type MentionFolderBrowserInput = {
  open: boolean;
  query: string;
  searchFiles: (query: string) => Promise<ComposerMentionTarget[]>;
  listFolderFiles: (path: string) => Promise<ComposerMentionTarget[]>;
};

function toMentionItems(targets: ComposerMentionTarget[]): MentionItem[] {
  return targets.map((target) => ({
    id: `${target.kind}:${target.path}`,
    kind: target.kind,
    value: target.path,
    label: target.path,
  }));
}

export function useMentionFolderBrowser(input: MentionFolderBrowserInput) {
  const [items, setItems] = useState<MentionItem[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [folderItems, setFolderItems] = useState<MentionItem[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderAdding, setFolderAdding] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!input.open || folderPath) return;
    let cancelled = false;
    void input
      .searchFiles(input.query)
      .then((targets) => {
        if (!cancelled) setItems(toMentionItems(targets));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [folderPath, input.open, input.query, input.searchFiles]);

  useEffect(() => {
    if (!input.open || !folderPath) return;
    let cancelled = false;
    setFolderLoading(true);
    void input
      .listFolderFiles(folderPath)
      .then((targets) => {
        if (!cancelled) setFolderItems(toMentionItems(targets));
      })
      .catch(() => {
        if (!cancelled) setFolderItems([]);
      })
      .finally(() => {
        if (!cancelled) setFolderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderPath, input.listFolderFiles, input.open]);

  useEffect(() => {
    if (input.open) return;
    setItems([]);
    setRootPath(null);
    setFolderPath(null);
    setFolderItems([]);
    setFolderLoading(false);
    setFolderAdding(false);
    setFolderError(null);
    setSelectedFilePaths(new Set());
  }, [input.open]);

  const filtered = useMemo(() => {
    if (!input.open) return [];
    if (!input.query) return items.slice(0, 8);
    return fuzzysort
      .go(input.query, items, { keys: ["label"], limit: 8 })
      .map((entry) => entry.obj);
  }, [input.open, input.query, items]);

  const openFolder = (path: string) => {
    setRootPath((current) => current ?? path);
    setFolderPath(path);
    setFolderItems([]);
    setFolderError(null);
  };

  const backFolder = () => {
    if (!folderPath || folderPath === rootPath) {
      setRootPath(null);
      setFolderPath(null);
      setFolderItems([]);
      setSelectedFilePaths(new Set());
      setFolderError(null);
      return;
    }
    const parent = folderPath.split("/").filter(Boolean).slice(0, -1).join("/");
    setFolderPath(parent || rootPath);
    setFolderItems([]);
    setFolderError(null);
  };

  const toggleFile = (path: string) => {
    setFolderError(null);
    setSelectedFilePaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const addSelectedFiles = async (
    loadFiles: (paths: string[]) => Promise<File[]>,
    addFiles: (files: File[]) => Promise<number>,
  ) => {
    const paths = Array.from(selectedFilePaths);
    if (!paths.length || folderAdding) return false;
    setFolderAdding(true);
    setFolderError(null);
    try {
      const files = await loadFiles(paths);
      return (await addFiles(files)) > 0;
    } catch {
      setFolderError(t("composer.folder_files_failed"));
      return false;
    } finally {
      setFolderAdding(false);
    }
  };

  return {
    filtered,
    folderPath,
    folderItems,
    folderLoading,
    folderAdding,
    folderError,
    selectedFilePaths,
    openFolder,
    backFolder,
    toggleFile,
    addSelectedFiles,
  };
}
