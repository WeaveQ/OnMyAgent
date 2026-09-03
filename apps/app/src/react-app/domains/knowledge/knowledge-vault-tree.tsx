/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";

import { t } from "../../../i18n";
import { cn } from "@/lib/utils";
import {
  KnowledgeVaultContextMenu,
  type KnowledgeContextTarget,
} from "./knowledge-vault-context-menu";
import {
  hideKnowledgeDragGhost,
  KnowledgeVaultDragLayer,
  releaseKnowledgeDragGhost,
  type KnowledgeDragLayerState,
} from "./knowledge-vault-drag-layer";
import {
  allKnowledgeFolderPaths,
  buildKnowledgeFolderTree,
  displayNoteTitle,
  folderPathsContaining,
  GETTING_STARTED_REL_PATH,
  noteKey,
  resolveKnowledgeDropFolder,
  type KnowledgeDropHover,
  type KnowledgeTreeNode,
  type KnowledgeVaultFile,
  type KnowledgeVaultScope,
  type KnowledgeNoteRef,
  type KnowledgeTreeSortKey,
} from "./knowledge-vault-model";

/** Match home sidebar LIST_ROW_H (34px) so vault rows share that rhythm. */
const VAULT_ROW_H = "h-[34px] min-h-[34px] max-h-[34px]";
const FOLDER_EXPAND_MS = 500;
const KNOWLEDGE_DRAG_MIME = "application/x-oma-knowledge-item";

export type KnowledgeTreeActions = {
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

type DragSource = { kind: "file" | "dir"; path: string; name: string };

type TreeDnd = {
  draggingPath: string | null;
  dropFolder: string | null;
  onItemDragStart: (event: React.DragEvent, source: DragSource) => void;
  onHover: (event: React.DragEvent, hover: KnowledgeDropHover) => void;
  onDropAt: (event: React.DragEvent, hover: KnowledgeDropHover) => void;
  onItemDragEnd: () => void;
};

type KnowledgeVaultTreeProps = {
  files: readonly KnowledgeVaultFile[];
  scope: KnowledgeVaultScope;
  selected: KnowledgeNoteRef | null;
  onSelect: (note: KnowledgeNoteRef) => void;
  actions: KnowledgeTreeActions;
  sortKey?: KnowledgeTreeSortKey;
  expandNonce?: number;
  collapseNonce?: number;
  revealNonce?: number;
  onAllExpandedChange?: (allExpanded: boolean) => void;
};

function dropLabel(dest: string, scope: KnowledgeVaultScope): string {
  if (!dest) {
    if (scope === "project") return t("knowledge.scope_project");
    if (scope === "expert") return t("knowledge.scope_expert");
    return t("knowledge.scope_user");
  }
  return dest.split("/").pop() ?? dest;
}

export function KnowledgeVaultTree(props: KnowledgeVaultTreeProps) {
  const tree = useMemo(
    () => buildKnowledgeFolderTree(props.files, props.sortKey),
    [props.files, props.sortKey],
  );
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [drag, setDrag] = useState<KnowledgeDragLayerState | null>(null);
  const sourceRef = useRef<DragSource | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingExpandRef = useRef<string | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!props.selected || props.selected.scope !== props.scope) return;
    const parents = folderPathsContaining(props.selected.relPath);
    if (parents.length === 0) return;
    setOpenDirs((current) => {
      const next = new Set(current);
      for (const path of parents) next.add(path);
      return next;
    });
  }, [props.scope, props.selected, props.revealNonce]);

  useEffect(() => {
    if (!props.revealNonce || !props.selected || props.selected.scope !== props.scope) return;
    const relPath = props.selected.relPath;
    const frame = window.requestAnimationFrame(() => {
      const escaped = relPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      treeRef.current
        ?.querySelector(`[data-knowledge-note="${escaped}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.revealNonce, props.scope, props.selected, openDirs]);

  useEffect(() => {
    if (!props.expandNonce) return;
    setOpenDirs(new Set(allKnowledgeFolderPaths(props.files)));
  }, [props.expandNonce, props.files]);

  useEffect(() => {
    if (!props.collapseNonce) return;
    setOpenDirs(new Set());
  }, [props.collapseNonce]);

  useEffect(() => {
    const folders = allKnowledgeFolderPaths(props.files);
    props.onAllExpandedChange?.(
      folders.length > 0 && folders.every((path) => openDirs.has(path)),
    );
  }, [openDirs, props.files, props.onAllExpandedChange]);

  const clearExpandTimer = () => {
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    expandTimerRef.current = null;
    pendingExpandRef.current = null;
  };

  const clearDrag = () => {
    sourceRef.current = null;
    setDrag(null);
    setDropFolder(null);
    clearExpandTimer();
    releaseKnowledgeDragGhost();
  };

  useEffect(() => {
    const onOver = (event: DragEvent) => {
      if (!sourceRef.current) return;
      if (event.clientX === 0 && event.clientY === 0) return;
      setDrag((current) =>
        current ? { ...current, x: event.clientX, y: event.clientY } : current,
      );
    };
    const onEnd = () => {
      sourceRef.current = null;
      setDrag(null);
      setDropFolder(null);
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
      pendingExpandRef.current = null;
      releaseKnowledgeDragGhost();
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragend", onEnd);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragend", onEnd);
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
      pendingExpandRef.current = null;
      sourceRef.current = null;
      releaseKnowledgeDragGhost();
    };
  }, []);

  const isKnowledgeDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types ?? []).includes(KNOWLEDGE_DRAG_MIME);

  const readDrag = (event: React.DragEvent): DragSource | null => {
    if (sourceRef.current) return sourceRef.current;
    const raw = event.dataTransfer.getData(KNOWLEDGE_DRAG_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { kind?: string; path?: string; name?: string };
      if ((parsed.kind === "file" || parsed.kind === "dir") && parsed.path) {
        return { kind: parsed.kind, path: parsed.path, name: parsed.name ?? parsed.path };
      }
    } catch {
      return null;
    }
    return null;
  };

  const scheduleExpand = (folder: string) => {
    if (openDirs.has(folder) || pendingExpandRef.current === folder) return;
    clearExpandTimer();
    pendingExpandRef.current = folder;
    expandTimerRef.current = setTimeout(() => {
      pendingExpandRef.current = null;
      setOpenDirs((current) => {
        if (current.has(folder)) return current;
        const next = new Set(current);
        next.add(folder);
        return next;
      });
    }, FOLDER_EXPAND_MS);
  };

  const hover = (event: React.DragEvent, target: KnowledgeDropHover) => {
    if (!isKnowledgeDrag(event)) return;
    const source = sourceRef.current;
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    const dest = resolveKnowledgeDropFolder(source, target);
    setDrag((current) =>
      current
        ? { ...current, x: event.clientX, y: event.clientY, destName: dest == null ? null : dropLabel(dest, props.scope) }
        : current,
    );
    if (dest == null) {
      event.dataTransfer.dropEffect = "none";
      setDropFolder(null);
      clearExpandTimer();
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setDropFolder(dest);
    if (target.kind === "dir" && dest === target.path) scheduleExpand(target.path);
    else if (pendingExpandRef.current && pendingExpandRef.current !== dest) clearExpandTimer();
  };

  const dropAt = (event: React.DragEvent, target: KnowledgeDropHover) => {
    const source = readDrag(event);
    event.preventDefault();
    event.stopPropagation();
    const dest = source ? resolveKnowledgeDropFolder(source, target) : null;
    clearDrag();
    if (!source || dest == null) return;
    props.actions.onDropMove(source, dest);
  };

  const startDrag = (event: React.DragEvent, source: DragSource) => {
    event.stopPropagation();
    sourceRef.current = source;
    event.dataTransfer.setData(KNOWLEDGE_DRAG_MIME, JSON.stringify(source));
    event.dataTransfer.setData("text/plain", source.path);
    event.dataTransfer.effectAllowed = "move";
    hideKnowledgeDragGhost(event);
    setDrag({ kind: source.kind, name: source.name, x: event.clientX, y: event.clientY, destName: null });
  };

  if (props.files.length === 0) {
    return (
      <KnowledgeVaultContextMenu target={{ kind: "root" }} {...props.actions}>
        <div className="flex min-h-full px-3 py-8 text-center text-sm text-dls-secondary">
          {t("knowledge.empty_title")}
        </div>
      </KnowledgeVaultContextMenu>
    );
  }

  const dnd: TreeDnd = {
    draggingPath: drag ? sourceRef.current?.path ?? null : null,
    dropFolder,
    onItemDragStart: startDrag,
    onHover: hover,
    onDropAt: dropAt,
    onItemDragEnd: clearDrag,
  };

  return (
    <>
      <KnowledgeVaultContextMenu target={{ kind: "root" }} {...props.actions}>
        <ul
          ref={treeRef}
          className={cn(
            "flex min-h-full flex-col px-2 py-1",
            dropFolder === "" && "rounded-md bg-dls-accent-soft ring-1 ring-inset ring-dls-accent",
          )}
          onDragOver={(event) => hover(event, { kind: "root", path: "" })}
          onDragLeave={(event) => {
            const related = event.relatedTarget as Node | null;
            if (related && event.currentTarget.contains(related)) return;
            setDropFolder(null);
            setDrag((current) => (current ? { ...current, destName: null } : current));
          }}
          onDrop={(event) => dropAt(event, { kind: "root", path: "" })}
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
              onToggle={(path) => {
                setOpenDirs((current) => {
                  const next = new Set(current);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                });
              }}
              onSelect={props.onSelect}
              actions={props.actions}
              dnd={dnd}
            />
          ))}
        </ul>
      </KnowledgeVaultContextMenu>
      <KnowledgeVaultDragLayer drag={drag} />
    </>
  );
}

function TreeNodeRow(props: {
  node: KnowledgeTreeNode;
  depth: number;
  scope: KnowledgeVaultScope;
  selected: KnowledgeNoteRef | null;
  openDirs: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onSelect: (note: KnowledgeNoteRef) => void;
  actions: KnowledgeTreeActions;
  dnd: TreeDnd;
}) {
  const pad = { paddingLeft: `${8 + props.depth * 12}px` };
  const { dnd } = props;

  if (props.node.kind === "dir") {
    const folder = props.node;
    const open = props.openDirs.has(folder.path);
    const favorited = props.actions.favorites.has(`dir:${folder.path}`);
    const dropping = dnd.dropFolder === folder.path;
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
            onDragStart={(event) => dnd.onItemDragStart(event, { kind: "dir", path: folder.path, name: folder.name })}
            onDragOver={(event) => dnd.onHover(event, { kind: "dir", path: folder.path })}
            onDrop={(event) => dnd.onDropAt(event, { kind: "dir", path: folder.path })}
            onDragEnd={dnd.onItemDragEnd}
            onClick={() => props.onToggle(folder.path)}
            className={cn(
              "flex w-full items-center gap-1 rounded-md pr-2 text-left text-sm",
              VAULT_ROW_H,
              dnd.draggingPath === folder.path && "opacity-50",
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
          <ul
            onDragOver={(event) => dnd.onHover(event, { kind: "dir", path: folder.path })}
            onDrop={(event) => dnd.onDropAt(event, { kind: "dir", path: folder.path })}
          >
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
                onToggle={props.onToggle}
                onSelect={props.onSelect}
                actions={props.actions}
                dnd={dnd}
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
  const draggable = file.relPath !== GETTING_STARTED_REL_PATH;

  return (
    <li>
      <KnowledgeVaultContextMenu
        target={{ kind: "file", relPath: file.relPath }}
        favorited={favorited}
        {...props.actions}
      >
        <button
          type="button"
          data-knowledge-note={file.relPath}
          draggable={draggable}
          onDragStart={(event) => {
            if (!draggable) return;
            dnd.onItemDragStart(event, { kind: "file", path: file.relPath, name: label });
          }}
          onDragOver={(event) => dnd.onHover(event, { kind: "file", path: file.relPath })}
          onDrop={(event) => dnd.onDropAt(event, { kind: "file", path: file.relPath })}
          onDragEnd={dnd.onItemDragEnd}
          onClick={() => props.onSelect({ scope: props.scope, relPath: file.relPath })}
          className={cn(
            "flex w-full items-center gap-1 rounded-md pr-2 text-left text-sm",
            VAULT_ROW_H,
            dnd.draggingPath === file.relPath && "opacity-50",
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
