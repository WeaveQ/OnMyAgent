/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";

import { t } from "../../../i18n";
import { cn } from "@/lib/utils";
import {
  KnowledgeVaultContextMenu,
  type KnowledgeContextTarget,
} from "./knowledge-vault-context-menu";
import {
  allKnowledgeFolderPaths,
  buildKnowledgeFolderTree,
  canDropKnowledgeItem,
  displayNoteTitle,
  folderPathsContaining,
  GETTING_STARTED_REL_PATH,
  noteKey,
  type KnowledgeTreeNode,
  type KnowledgeVaultFile,
  type KnowledgeVaultScope,
  type KnowledgeNoteRef,
} from "./knowledge-vault-model";

type KnowledgeTreeActions = {
  favorites: ReadonlySet<string>;
  onNewNote: (folder: string) => void;
  onNewFolder: (folder: string) => void;
  onDuplicate: (relPath: string) => void;
  onMove: (target: KnowledgeContextTarget) => void;
  onSearchInFolder: (folder: string) => void;
  onFavorite: (target: KnowledgeContextTarget) => void;
  onCopyPath: (target: KnowledgeContextTarget, which: "rel" | "abs") => void;
  onReveal: (target: KnowledgeContextTarget) => void;
  onRename: (target: KnowledgeContextTarget) => void;
  onDelete: (target: KnowledgeContextTarget) => void;
  onDropMove: (source: { kind: "file" | "dir"; path: string }, destFolder: string) => void;
};

const KNOWLEDGE_DRAG_MIME = "application/x-oma-knowledge-item";

type KnowledgeVaultTreeProps = {
  files: readonly KnowledgeVaultFile[];
  scope: KnowledgeVaultScope;
  selected: KnowledgeNoteRef | null;
  onSelect: (note: KnowledgeNoteRef) => void;
  actions: KnowledgeTreeActions;
  expandNonce?: number;
  collapseNonce?: number;
};

export function KnowledgeVaultTree(props: KnowledgeVaultTreeProps) {
  const tree = useMemo(() => buildKnowledgeFolderTree(props.files), [props.files]);
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  const [dropFolder, setDropFolder] = useState<string | null>(null);

  useEffect(() => {
    if (!props.selected || props.selected.scope !== props.scope) return;
    const parents = folderPathsContaining(props.selected.relPath);
    if (parents.length === 0) return;
    setOpenDirs((current) => {
      const next = new Set(current);
      for (const path of parents) next.add(path);
      return next;
    });
  }, [props.scope, props.selected]);

  useEffect(() => {
    if (!props.expandNonce) return;
    setOpenDirs(new Set(allKnowledgeFolderPaths(props.files)));
  }, [props.expandNonce, props.files]);

  useEffect(() => {
    if (!props.collapseNonce) return;
    setOpenDirs(new Set());
  }, [props.collapseNonce]);

  if (props.files.length === 0) {
    return (
      <KnowledgeVaultContextMenu target={{ kind: "root" }} {...props.actions}>
        <div className="flex min-h-full px-3 py-8 text-center text-sm text-dls-secondary">
          {t("knowledge.empty_title")}
        </div>
      </KnowledgeVaultContextMenu>
    );
  }

  const readDrag = (event: React.DragEvent): { kind: "file" | "dir"; path: string } | null => {
    const raw = event.dataTransfer.getData(KNOWLEDGE_DRAG_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { kind?: string; path?: string };
      if ((parsed.kind === "file" || parsed.kind === "dir") && parsed.path) {
        return { kind: parsed.kind, path: parsed.path };
      }
    } catch {
      return null;
    }
    return null;
  };

  const allowDrop = (event: React.DragEvent, destFolder: string) => {
    const types = Array.from(event.dataTransfer.types ?? []);
    if (!types.includes(KNOWLEDGE_DRAG_MIME)) return false;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropFolder(destFolder);
    return true;
  };

  const handleDrop = (event: React.DragEvent, destFolder: string) => {
    const source = readDrag(event);
    setDropFolder(null);
    if (!source || !canDropKnowledgeItem(source, destFolder)) return;
    event.preventDefault();
    event.stopPropagation();
    props.actions.onDropMove(source, destFolder);
  };

  const toggleDir = (path: string) => {
    setOpenDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <KnowledgeVaultContextMenu target={{ kind: "root" }} {...props.actions}>
      <ul
        className="flex min-h-full flex-col px-1 py-1"
        onDragOver={(event) => allowDrop(event, "")}
        onDragLeave={(event) => {
          const related = event.relatedTarget as Node | null;
          if (related && event.currentTarget.contains(related)) return;
          setDropFolder((current) => (current === "" ? null : current));
        }}
        onDrop={(event) => handleDrop(event, "")}
      >
        {tree.map((node) => (
          <TreeNodeRow
            key={
              node.kind === "dir"
                ? `dir:${node.path}`
                : noteKey({ scope: props.scope, relPath: node.file.relPath })
            }
            node={node}
            depth={0}
            scope={props.scope}
            selected={props.selected}
            openDirs={openDirs}
            dropFolder={dropFolder}
            onToggle={toggleDir}
            onSelect={props.onSelect}
            actions={props.actions}
            onDragStart={(event, source) => {
              event.dataTransfer.setData(KNOWLEDGE_DRAG_MIME, JSON.stringify(source));
              event.dataTransfer.setData("text/plain", source.path);
              event.dataTransfer.effectAllowed = "move";
            }}
            onFolderDragOver={(event, folder) => {
              if (allowDrop(event, folder)) {
                setOpenDirs((current) => {
                  if (current.has(folder)) return current;
                  const next = new Set(current);
                  next.add(folder);
                  return next;
                });
              }
            }}
            onFolderDrop={(event, folder) => handleDrop(event, folder)}
          />
        ))}
      </ul>
    </KnowledgeVaultContextMenu>
  );
}

function TreeNodeRow(props: {
  node: KnowledgeTreeNode;
  depth: number;
  scope: KnowledgeVaultScope;
  selected: KnowledgeNoteRef | null;
  openDirs: ReadonlySet<string>;
  dropFolder: string | null;
  onToggle: (path: string) => void;
  onSelect: (note: KnowledgeNoteRef) => void;
  actions: KnowledgeTreeActions;
  onDragStart: (event: React.DragEvent, source: { kind: "file" | "dir"; path: string }) => void;
  onFolderDragOver: (event: React.DragEvent, folder: string) => void;
  onFolderDrop: (event: React.DragEvent, folder: string) => void;
}) {
  const pad = { paddingLeft: `${8 + props.depth * 12}px` };

  if (props.node.kind === "dir") {
    const folder = props.node;
    const open = props.openDirs.has(folder.path);
    const favorited = props.actions.favorites.has(`dir:${folder.path}`);
    const dropping = props.dropFolder === folder.path;
    return (
      <li>
        <KnowledgeVaultContextMenu
          target={{ kind: "dir", path: folder.path }}
          favorited={favorited}
          {...props.actions}
        >
          <button
            type="button"
            draggable
            title={dropping ? t("knowledge.drop_move_to", { name: folder.name }) : undefined}
            onDragStart={(event) => {
              event.stopPropagation();
              props.onDragStart(event, { kind: "dir", path: folder.path });
            }}
            onDragOver={(event) => props.onFolderDragOver(event, folder.path)}
            onDrop={(event) => props.onFolderDrop(event, folder.path)}
            onClick={() => props.onToggle(folder.path)}
            className={cn(
              "flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-sm",
              dropping
                ? "bg-dls-accent-soft text-dls-accent"
                : "text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
            )}
            style={pad}
          >
            {open ? (
              <ChevronDown className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
            )}
            <Folder className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{props.node.name}</span>
          </button>
        </KnowledgeVaultContextMenu>
        {open ? (
          <ul>
            {props.node.children.map((child) => (
              <TreeNodeRow
                key={
                  child.kind === "dir"
                    ? `dir:${child.path}`
                    : noteKey({ scope: props.scope, relPath: child.file.relPath })
                }
                node={child}
                depth={props.depth + 1}
                scope={props.scope}
                selected={props.selected}
                openDirs={props.openDirs}
                dropFolder={props.dropFolder}
                onToggle={props.onToggle}
                onSelect={props.onSelect}
                actions={props.actions}
                onDragStart={props.onDragStart}
                onFolderDragOver={props.onFolderDragOver}
                onFolderDrop={props.onFolderDrop}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  if (props.node.kind !== "file") return null;
  const file = props.node.file;
  const active = props.selected?.scope === props.scope && props.selected.relPath === file.relPath;
  const label =
    file.relPath === GETTING_STARTED_REL_PATH
      ? t("knowledge.getting_started")
      : displayNoteTitle(file);

  const favorited = props.actions.favorites.has(
    noteKey({ scope: props.scope, relPath: file.relPath }),
  );

  return (
    <li>
      <KnowledgeVaultContextMenu
        target={{ kind: "file", relPath: file.relPath }}
        favorited={favorited}
        {...props.actions}
      >
        <button
          type="button"
          draggable={file.relPath !== GETTING_STARTED_REL_PATH}
          onDragStart={(event) => {
            event.stopPropagation();
            props.onDragStart(event, { kind: "file", path: file.relPath });
          }}
          onClick={() => props.onSelect({ scope: props.scope, relPath: file.relPath })}
          className={cn(
            "flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-sm",
            active
              ? "bg-dls-list-selected text-dls-text"
              : "text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
          )}
          style={pad}
        >
          <span className="inline-flex w-3.5 shrink-0" aria-hidden />
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </KnowledgeVaultContextMenu>
    </li>
  );
}
