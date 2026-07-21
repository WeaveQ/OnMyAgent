/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ChevronRight,
  ClipboardCheck,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  MoreHorizontal,
  PanelRight,
  Plus,
  SquareTerminal,
  Trash2,
} from "lucide-react";

import type {
  OnMyAgentServerClient,
  OnMyAgentWorkspaceFileCatalogEntry,
} from "../../../../app/lib/onmyagent-server";
import {
  closeCodeWorkspaceTerminal,
  createCodeWorkspaceTerminal,
  getCodeWorkspaceTerminalSnapshot,
  listCodeWorkspaceFiles,
  readCodeWorkspaceFile,
  resizeCodeWorkspaceTerminal,
  revealDesktopItemInDir,
  writeCodeWorkspaceTerminal,
} from "../../../../app/lib/desktop";
import type {
  CodeWorkspaceTerminal,
} from "@onmyagent/types";
import { t } from "../../../../i18n";
import { isElectronRuntime } from "../../../../app/utils";
import { classifyOpenTarget, resolveArtifactAbsolutePath, type OpenTarget } from "../artifacts/open-target";
import { PanelTab, PanelTabClose, PanelTabItem, PanelTabList } from "@/components/panel-tabs";
import { MenuRowButton, TreeRowButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  HTMLPreview,
  ImagePreview,
  MarkdownPreview,
  PlainText,
  PreviewError,
  PreviewLoading,
} from "../artifacts/preview";
import {
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  type WorkspaceFileTreeNode,
} from "../chat/session-page-files-model";
import { BrowserPanel } from "../browser/browser-panel";
import { openInAppBrowser } from "../browser/open-in-app-browser";
import { CodeWorkspaceReviewPanel } from "./code-workspace-review";

type ToolKind = "review" | "terminal" | "browser" | "files";

type ToolTab = {
  id: string;
  kind: ToolKind;
  label: string;
  terminal?: CodeWorkspaceTerminal;
};

/** Durable tool chips (no live terminal handle) restored after side-panel unmount. */
type DurableToolTab = {
  id: string;
  kind: Exclude<ToolKind, "terminal">;
  label: string;
};

type WorkspacePanelSnapshot = {
  tabs: DurableToolTab[];
  activeId: string | null;
};

/**
 * Side panel unmounts when closed (`sidePanelVisible ? … : null`). Keep tool
 * tabs (browser/files/review) per session so reopening restores chrome; browser
 * page tabs live in Electron and survive independently.
 */
const workspacePanelSnapshots = new Map<string, WorkspacePanelSnapshot>();

function workspacePanelCacheKey(
  sessionId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return `${sessionId?.trim() || "no-session"}::${workspaceId?.trim() || "no-workspace"}`;
}

function toDurableTabs(tabs: ToolTab[]): DurableToolTab[] {
  return tabs.flatMap((tab) => {
    if (tab.kind === "terminal") return [];
    return [{ id: tab.id, kind: tab.kind, label: tab.label }];
  });
}

function readWorkspacePanelSnapshot(key: string): WorkspacePanelSnapshot | null {
  return workspacePanelSnapshots.get(key) ?? null;
}

function writeWorkspacePanelSnapshot(key: string, tabs: ToolTab[], activeId: string | null) {
  const durable = toDurableTabs(tabs);
  if (durable.length === 0) {
    workspacePanelSnapshots.delete(key);
    return;
  }
  const activeStillPresent = activeId && durable.some((tab) => tab.id === activeId);
  workspacePanelSnapshots.set(key, {
    tabs: durable,
    activeId: activeStillPresent ? activeId : durable[0]?.id ?? null,
  });
}

const toolItems: Array<{
  kind: ToolKind;
  labelKey: string;
  icon: typeof ClipboardCheck;
}> = [
  { kind: "review", labelKey: "session.code_side_panel_review", icon: ClipboardCheck },
  { kind: "terminal", labelKey: "session.code_side_panel_terminal", icon: SquareTerminal },
  { kind: "browser", labelKey: "session.code_side_panel_browser", icon: Globe },
  { kind: "files", labelKey: "session.code_side_panel_files", icon: Folder },
];

function toolIcon(kind: ToolKind) {
  return toolItems.find((item) => item.kind === kind)?.icon ?? FileText;
}

function flattenWorkspaceFileTree(
  node: WorkspaceFileTreeNode,
): OnMyAgentWorkspaceFileCatalogEntry[] {
  return node.children.flatMap((child) => [
    {
      path: child.path,
      kind: child.kind,
      size: child.size,
      mtimeMs: child.mtimeMs,
      revision: "",
    },
    ...flattenWorkspaceFileTree(child),
  ]);
}

function openTargetsToCatalogEntries(
  targets: OpenTarget[] | undefined,
): OnMyAgentWorkspaceFileCatalogEntry[] {
  return (targets ?? []).flatMap((target) => {
    if (target.kind !== "file" || !target.value.trim()) return [];
    return [{
      path: target.value.trim().replace(/\\/g, "/").replace(/^\.\//, ""),
      kind: "file" as const,
      size: target.size ?? 0,
      mtimeMs: target.updatedAt ?? 0,
      revision: "",
    }];
  });
}

type WorkspaceFilePreview =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "text"; content: string; format: "html" | "markdown" | "text" }
  | { kind: "binary"; url: string; name: string };

function absoluteWorkspaceFilePath(root: string, path: string) {
  return resolveArtifactAbsolutePath(path, root) ?? path.trim();
}

function workspaceFileRequestPath(rootRelativePrefix: string, path: string) {
  return rootRelativePrefix ? `${rootRelativePrefix}/${path}` : path;
}

function isTextSheet(path: string) {
  return /\.(csv|tsv)$/i.test(path);
}

function inferredImageContentType(path: string) {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

function WorkspaceTreeRow(props: {
  node: WorkspaceFileTreeNode;
  level: number;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onReveal: (path: string) => void;
  onDelete: (node: WorkspaceFileTreeNode) => void;
}) {
  const isDirectory = props.node.kind === "dir";
  const isExpanded = props.expanded.has(props.node.path);
  const Icon = isDirectory ? (isExpanded ? FolderOpen : Folder) : FileText;
  return (
    <div>
      <div className="group relative">
        <TreeRowButton
          type="button"
          depth={props.level === 0 ? "root" : "child"}
          className={cn(
            "min-h-7 rounded-lg py-1.5 pr-8 text-xs text-dls-secondary hover:text-dls-text",
            props.selectedPath === props.node.path && "bg-dls-hover text-dls-text",
          )}
          style={{ paddingLeft: 8 + props.level * 14 }}
          onClick={() => {
            if (isDirectory) props.onToggle(props.node.path);
            else props.onSelect(props.node.path);
          }}
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              !isDirectory && "opacity-0",
              isExpanded && "rotate-90",
            )}
          />
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{props.node.name}</span>
        </TreeRowButton>
        {!isDirectory ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-popup-open:opacity-100"
                  aria-label={t("files.file_actions", { name: props.node.name })}
                  title={t("files.file_actions", { name: props.node.name })}
                >
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => props.onReveal(props.node.path)}>
                <FolderOpen />
                {t("files.open_in_folder")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => props.onDelete(props.node)}>
                <Trash2 />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {isDirectory && isExpanded
        ? props.node.children.map((child) => (
            <WorkspaceTreeRow
              key={child.path}
              node={child}
              level={props.level + 1}
              expanded={props.expanded}
              selectedPath={props.selectedPath}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
              onReveal={props.onReveal}
              onDelete={props.onDelete}
            />
          ))
        : null}
    </div>
  );
}

function WorkspaceFilesPanel(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string | null;
  workspaceCatalogRoot: string;
  workspacePath: string;
  fileRoot?: string | null;
  fileTargets?: OpenTarget[];
}) {
  const [tree, setTree] = useState<WorkspaceFileTreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkspaceFilePreview>({ kind: "empty" });
  const [pendingDeleteNode, setPendingDeleteNode] = useState<WorkspaceFileTreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedDirectories, setLoadedDirectories] = useState<Set<string>>(
    new Set(),
  );
  const fileRoot =
    props.fileRoot === undefined ? props.workspacePath : props.fileRoot?.trim() ?? "";
  const hasScopedFileRoot = props.fileRoot !== undefined && Boolean(fileRoot);
  const requiresSessionFileRoot = props.fileRoot !== undefined;
  const rootRelativePrefix = useMemo(() => {
    const root = props.workspaceCatalogRoot.replaceAll("\\", "/").replace(/\/+$/, "");
    const selected = fileRoot.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!root || !selected || selected === root) return "";
    return selected.startsWith(`${root}/`) ? selected.slice(root.length + 1) : "";
  }, [fileRoot, props.workspaceCatalogRoot]);
  const catalogPrefix = hasScopedFileRoot ? "" : rootRelativePrefix;

  useEffect(() => {
    if (!fileRoot.trim()) {
      setTree(
        filterHiddenFromTree(
          buildWorkspaceFileTree(openTargetsToCatalogEntries(props.fileTargets)),
        ),
      );
      setLoadedDirectories(new Set([""]));
      setExpanded(new Set());
      setSelectedPath(null);
      setPreview({ kind: "empty" });
      setError(null);
      return;
    }
    if (isElectronRuntime() && fileRoot) {
      let disposed = false;
      setError(null);
      void listCodeWorkspaceFiles({ workspacePath: fileRoot })
        .then((result) => {
          if (disposed) return;
          setTree(
            filterHiddenFromTree(
              buildWorkspaceFileTree(
                result.items.map((item) => ({ ...item, revision: "" })),
              ),
            ),
          );
          setLoadedDirectories(new Set([""]));
          setExpanded(new Set());
        })
        .catch((nextError) => {
          if (!disposed) {
            setError(
              nextError instanceof Error ? nextError.message : String(nextError),
            );
          }
        });
      return () => {
        disposed = true;
      };
    }
    if (!props.client || !props.workspaceId) return;
    let disposed = false;
    setError(null);
    void props.client
      .listWorkspaceFiles(props.workspaceId, {
        includeDirs: true,
        limit: 10_000,
        ...(hasScopedFileRoot ? { root: fileRoot } : {}),
        prefix: catalogPrefix || undefined,
      })
      .then((result) => {
        if (disposed) return;
        const prefixWithSlash = catalogPrefix ? `${catalogPrefix}/` : "";
        const items = result.items.flatMap((item) => {
          if (catalogPrefix && item.path === catalogPrefix) return [];
          if (catalogPrefix && !item.path.startsWith(prefixWithSlash)) return [];
          return [{
            ...item,
            path: catalogPrefix ? item.path.slice(prefixWithSlash.length) : item.path,
          }];
        });
        const nextTree = filterHiddenFromTree(buildWorkspaceFileTree(items));
        setTree(nextTree);
        setExpanded(new Set(nextTree.children.filter((node) => node.kind === "dir").map((node) => node.path)));
      })
      .catch((nextError) => {
        if (!disposed) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      disposed = true;
    };
  }, [
    catalogPrefix,
    fileRoot,
    hasScopedFileRoot,
    props.client,
    props.fileTargets,
    props.workspaceId,
  ]);

  useEffect(() => {
    if (preview.kind !== "binary") return;
    const url = preview.url;
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const revealFile = useCallback(
    async (path: string) => {
      const root = fileRoot || props.workspacePath;
      if (!root || !isElectronRuntime()) return;
      await revealDesktopItemInDir(absoluteWorkspaceFilePath(root, path));
    },
    [fileRoot, props.workspacePath],
  );

  const selectFile = useCallback(
    async (path: string) => {
      const targetPreview = classifyOpenTarget(path, "file");
      const targetName = path.split("/").filter(Boolean).at(-1) ?? path;
      if (
        targetPreview === "external"
        || targetPreview === "pdf"
        || (targetPreview === "sheet" && !isTextSheet(path))
      ) {
        setSelectedPath(path);
        setError(null);
        setPreview({ kind: "unsupported" });
        return;
      }
      if (
        (!isElectronRuntime() || !fileRoot) &&
        (!props.client || !props.workspaceId)
      ) {
        return;
      }
      setSelectedPath(path);
      setError(null);
      setPreview({ kind: "loading" });
      try {
        const requestPath = workspaceFileRequestPath(rootRelativePrefix, path);
        if (targetPreview === "image") {
          const client = props.client;
          const workspaceId = props.workspaceId;
          if (!client || !workspaceId) return;
          const result = await client.downloadWorkspaceFile(workspaceId, requestPath);
          const fallbackType = inferredImageContentType(path);
          const contentType = result.contentType && result.contentType !== "application/octet-stream"
            ? result.contentType
            : fallbackType;
          const url = URL.createObjectURL(new Blob([result.data], { type: contentType }));
          setPreview({ kind: "binary", url, name: targetName });
          return;
        }

        let result;
        if (isElectronRuntime() && fileRoot) {
          result = await readCodeWorkspaceFile({ workspacePath: fileRoot, relativePath: path });
        } else {
          const client = props.client;
          const workspaceId = props.workspaceId;
          if (!client || !workspaceId) return;
          result = await client.readWorkspaceFile(workspaceId, requestPath);
        }
        const format = targetPreview === "markdown"
          ? "markdown"
          : targetPreview === "html"
            ? "html"
            : "text";
        setPreview({ kind: "text", content: result.content, format });
      } catch (nextError) {
        setPreview({ kind: "empty" });
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    },
    [fileRoot, rootRelativePrefix, props.client, props.workspaceId, props.workspacePath],
  );

  const confirmDeleteFile = useCallback(async () => {
    const node = pendingDeleteNode;
    const client = props.client;
    const workspaceId = props.workspaceId;
    if (!node || !client || !workspaceId) return;

    try {
      const requestPath = workspaceFileRequestPath(rootRelativePrefix, node.path);
      await client.deleteWorkspaceFile(
        workspaceId,
        hasScopedFileRoot ? node.path : requestPath,
        hasScopedFileRoot ? { root: fileRoot } : undefined,
      );
      setTree((current) => {
        if (!current) return current;
        const entries = flattenWorkspaceFileTree(current).filter((item) => item.path !== node.path);
        return filterHiddenFromTree(buildWorkspaceFileTree(entries));
      });
      if (selectedPath === node.path) {
        setSelectedPath(null);
        setPreview({ kind: "empty" });
        setError(null);
      }
      setPendingDeleteNode(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [fileRoot, hasScopedFileRoot, pendingDeleteNode, props.client, props.workspaceId, rootRelativePrefix, selectedPath]);

  const toggleDirectory = useCallback(
    async (path: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      if (
        !isElectronRuntime() ||
        !fileRoot ||
        loadedDirectories.has(path)
      ) {
        return;
      }
      try {
        const result = await listCodeWorkspaceFiles({
          workspacePath: fileRoot,
          relativePath: path,
        });
        setTree((current) => {
          if (!current) return current;
          const entries = [
            ...flattenWorkspaceFileTree(current),
            ...result.items.map((item) => ({ ...item, revision: "" })),
          ];
          return filterHiddenFromTree(buildWorkspaceFileTree(entries));
        });
        setLoadedDirectories((current) => new Set(current).add(path));
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    },
    [fileRoot, loadedDirectories],
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] bg-dls-background">
      <div className="min-h-0 overflow-auto border-r border-dls-border p-2">
        {tree?.children.length ? tree.children.map((node) => (
          <WorkspaceTreeRow
            key={node.path}
            node={node}
            level={0}
            expanded={expanded}
            selectedPath={selectedPath}
            onSelect={(path) => void selectFile(path)}
            onToggle={(path) => void toggleDirectory(path)}
            onReveal={(path) => void revealFile(path)}
            onDelete={setPendingDeleteNode}
          />
        )) : (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <div
              className="flex size-10 items-center justify-center rounded-xl bg-dls-surface-muted text-dls-secondary ring-1 ring-dls-border/60"
              aria-hidden="true"
            >
              <FolderOpen className="size-5" strokeWidth={1.5} />
            </div>
            <p className="text-xs font-medium text-dls-text">
              {requiresSessionFileRoot ? t("files.no_session_files") : t("files.no_files")}
            </p>
            <p className="text-xs leading-4 text-dls-secondary">
              {requiresSessionFileRoot
                ? t("files.no_session_files_hint")
                : t("files.no_files_hint")}
            </p>
          </div>
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-dls-border px-3 text-xs text-dls-secondary">
          <span className="min-w-0 flex-1 truncate">
            {selectedPath ?? t("session.code_side_panel_files")}
          </span>
          {selectedPath && isElectronRuntime() && (fileRoot || props.workspacePath) ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 mac:titlebar-no-drag"
              onClick={() => void revealFile(selectedPath)}
            >
              <FolderOpen />
              {t("session.open_artifact")}
            </Button>
          ) : null}
        </div>
        {error ? (
          <PreviewError className="min-h-0 flex-1" message={t("files.preview_failed")} />
        ) : preview.kind === "loading" ? (
          <PreviewLoading className="min-h-0 flex-1" />
        ) : preview.kind === "unsupported" ? (
          <div className="min-h-0 flex-1 p-4 text-sm text-dls-secondary">
            {t("files.preview_unsupported")}
          </div>
        ) : preview.kind === "binary" ? (
          <ImagePreview className="min-h-0 flex-1" src={preview.url} alt={preview.name} />
        ) : preview.kind === "text" && preview.format === "markdown" ? (
          <MarkdownPreview className="min-h-0 flex-1" content={preview.content} />
        ) : preview.kind === "text" && preview.format === "html" ? (
          <HTMLPreview className="min-h-0 flex-1" type="text" title={selectedPath ?? ""} content={preview.content} />
        ) : preview.kind === "text" ? (
          <PlainText className="min-h-0 flex-1" content={preview.content} />
        ) : (
          <div className="min-h-0 flex-1 p-4 text-sm text-dls-secondary">
            {t("files.preview_empty")}
          </div>
        )}
      </div>
      <ConfirmModal
        open={Boolean(pendingDeleteNode)}
        title={t("files.delete_confirm_title")}
        message={t("files.delete_confirm_desc", { name: pendingDeleteNode?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void confirmDeleteFile()}
        onCancel={() => setPendingDeleteNode(null)}
      />
    </div>
  );
}

function TerminalPanel(props: { terminal: CodeWorkspaceTerminal }) {
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputLengthRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isDark =
      document.documentElement.dataset.theme === "dark" ||
      document.documentElement.classList.contains("dark");
    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: isDark
        ? {
            // Match shell three-tier dark canvas (DESIGN.md / index.css).
            background: "#1F1F1F",
            foreground: "#F8FAFC",
            cursor: "#F8FAFC",
            selectionBackground: "rgba(47, 123, 255, 0.28)",
            selectionForeground: "#F8FAFC",
          }
        : {
            background: "#FFFFFF",
            foreground: "#0F172A",
            cursor: "#0F172A",
            selectionBackground: "rgba(0, 93, 255, 0.18)",
            selectionForeground: "#0F172A",
          },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.focus();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        event.key === "Tab" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        void writeCodeWorkspaceTerminal({
          terminalId: props.terminal.terminalId,
          data: event.shiftKey ? "\u001b[Z" : "\t",
        }).catch((nextError) => {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        });
        return false;
      }
      return true;
    });
    const dataDisposable = terminal.onData((data) => {
      void writeCodeWorkspaceTerminal({
        terminalId: props.terminal.terminalId,
        data,
      }).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    });
    const fit = () => {
      try {
        fitAddon.fit();
        void resizeCodeWorkspaceTerminal({
          terminalId: props.terminal.terminalId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      } catch {
      }
    };
    const frame = window.requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      outputLengthRef.current = 0;
    };
  }, [props.terminal.terminalId]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await getCodeWorkspaceTerminalSnapshot({ terminalId: props.terminal.terminalId });
        if (disposed) return;
        const terminal = terminalRef.current;
        if (!terminal) return;
        if (next.output.length < outputLengthRef.current) {
          terminal.reset();
          outputLengthRef.current = 0;
        }
        const chunk = next.output.slice(outputLengthRef.current);
        if (chunk) terminal.write(chunk);
        outputLengthRef.current = next.output.length;
      } catch (nextError) {
        if (!disposed) setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [props.terminal.terminalId]);

  return (
    <div className="relative h-full min-h-0 bg-dls-background text-dls-text">
      <div
        ref={containerRef}
        className="h-full min-h-0 w-full overflow-hidden bg-dls-background p-3 text-dls-text [&_.xterm]:h-full [&_.xterm-viewport]:bg-dls-background [&_.xterm-screen]:outline-none"
        data-code-terminal="true"
      />
      {error ? (
        <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-status-danger-fg">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function CodeWorkspaceSidePanel(props: {
  workspacePath: string | null;
  workspaceCatalogRoot: string;
  fileRoot?: string | null;
  fileTargets?: OpenTarget[];
  workspaceId: string | null;
  sessionId: string | null;
  client: OnMyAgentServerClient | null;
  initialKind?: ToolKind | null;
  onClose: () => void;
  hiddenKinds?: ToolKind[];
}) {
  const cacheKey = workspacePanelCacheKey(props.sessionId, props.workspaceId);
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const [tabs, setTabs] = useState<ToolTab[]>(() => {
    const snapshot = readWorkspacePanelSnapshot(cacheKey);
    return snapshot?.tabs.map((tab) => ({ ...tab })) ?? [];
  });
  const [activeId, setActiveId] = useState<string | null>(() => {
    const snapshot = readWorkspacePanelSnapshot(cacheKey);
    return snapshot?.activeId ?? null;
  });
  const tabsRef = useRef<ToolTab[]>(tabs);
  const activeIdRef = useRef<string | null>(activeId);
  const restoredKind =
    tabs.find((tab) => tab.id === activeId)?.kind
    ?? tabs[0]?.kind
    ?? null;
  const lastInitialKindRef = useRef<ToolKind | null>(
    restoredKind === "terminal" ? null : restoredKind,
  );
  // Fall back to the first tab when activeId is briefly out of sync (e.g. after
  // async addTab) so content is never blank while a top tab chip is visible.
  const activeTab =
    tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
  const visibleToolItems = useMemo(
    () => toolItems.filter((item) => !props.hiddenKinds?.includes(item.kind)),
    [props.hiddenKinds],
  );

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Persist durable tool tabs whenever they change so close/reopen restores them.
  useEffect(() => {
    writeWorkspacePanelSnapshot(cacheKey, tabs, activeId);
  }, [activeId, cacheKey, tabs]);

  // Session/workspace switch: load that scope's snapshot (or empty).
  useEffect(() => {
    const snapshot = readWorkspacePanelSnapshot(cacheKey);
    const nextTabs = snapshot?.tabs.map((tab) => ({ ...tab })) ?? [];
    setTabs(nextTabs);
    setActiveId(snapshot?.activeId ?? null);
    const kind =
      nextTabs.find((tab) => tab.id === snapshot?.activeId)?.kind
      ?? nextTabs[0]?.kind
      ?? null;
    // Durable snapshots never include live terminal tabs.
    lastInitialKindRef.current = kind;
  }, [cacheKey]);

  // Heal activeId when tabs exist but selection is missing/stale so content
  // mounts immediately (office/code browser+files all use this surface).
  useEffect(() => {
    if (tabs.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (activeId && tabs.some((tab) => tab.id === activeId)) return;
    setActiveId(tabs[0]!.id);
  }, [activeId, tabs]);

  useEffect(
    () => () => {
      writeWorkspacePanelSnapshot(
        cacheKeyRef.current,
        tabsRef.current,
        activeIdRef.current,
      );
      for (const tab of tabsRef.current) {
        if (tab.terminal) {
          void closeCodeWorkspaceTerminal({
            terminalId: tab.terminal.terminalId,
          }).catch(() => undefined);
        }
      }
    },
    [],
  );

  const addTab = useCallback(
    async (kind: ToolKind, options?: { seedHomeWhenEmpty?: boolean }) => {
      if (props.hiddenKinds?.includes(kind)) return;

      // One browser/files/review tool surface per session side panel. Multiple
      // page tabs live *inside* BrowserPanel, not as duplicate tool chips.
      if (kind !== "terminal") {
        // User open browser: ensure a session page tab *before* mounting BrowserPanel
        // so the viewport activates on first paint (no empty shell → late show race).
        if (kind === "browser" && options?.seedHomeWhenEmpty && props.sessionId) {
          await openInAppBrowser({
            openSidePanel: () => undefined,
            sessionId: props.sessionId,
            seedHomeWhenEmpty: true,
          }).catch(() => undefined);
        }

        // Deterministic singleton id — never rely on setState updater side-effects
        // to set activeId (after `await`, React may defer the updater and leave
        // activeId null → top tab visible, content empty until user re-clicks).
        const singletonId = `${kind}-singleton`;
        const label = t(
          toolItems.find((item) => item.kind === kind)?.labelKey ??
            "session.code_side_panel_files",
        );
        setTabs((current) => {
          if (current.some((tab) => tab.kind === kind || tab.id === singletonId)) {
            return current;
          }
          return [...current, { id: singletonId, kind, label }];
        });
        setActiveId(singletonId);
        return;
      }

      const terminal = await createCodeWorkspaceTerminal({
        workspacePath: props.workspacePath,
      });
      const id = terminal.terminalId;
      const next: ToolTab = {
        id,
        kind,
        label: terminal.title,
        terminal,
      };
      setTabs((current) => [...current, next]);
      setActiveId(id);
    },
    [props.hiddenKinds, props.sessionId, props.workspacePath],
  );

  // Ensure the requested tool tab exists once. Do not re-run addTab on every
  // parent re-render when initialKind stays "browser" (agent state spam).
  useEffect(() => {
    const nextInitialKind = props.initialKind ?? null;
    if (!nextInitialKind || props.hiddenKinds?.includes(nextInitialKind)) {
      return;
    }
    if (lastInitialKindRef.current === nextInitialKind) {
      // Still focus existing singleton if present.
      if (nextInitialKind !== "terminal") {
        const singletonId = `${nextInitialKind}-singleton`;
        setActiveId(singletonId);
      }
      return;
    }
    lastInitialKindRef.current = nextInitialKind;
    // User-driven panel open (browser/files/review) should seed browser home when empty.
    // Agent auto-open uses the same initialKind — seedHomeWhenEmpty only creates Baidu
    // when there is no page tab yet, so agent tabs that already exist are preserved.
    void addTab(
      nextInitialKind,
      nextInitialKind === "browser" ? { seedHomeWhenEmpty: true } : undefined,
    );
  }, [addTab, props.hiddenKinds, props.initialKind]);

  const closeTab = async (tab: ToolTab) => {
    if (tab.terminal) {
      await closeCodeWorkspaceTerminal({ terminalId: tab.terminal.terminalId }).catch(() => undefined);
    }
    setTabs((current) => {
      const index = current.findIndex((item) => item.id === tab.id);
      const next = current.filter((item) => item.id !== tab.id);
      if (activeId === tab.id) setActiveId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null);
      return next;
    });
  };

  const content = useMemo(() => {
    if (!activeTab) return null;
    if (activeTab.kind === "review") {
      return (
        <CodeWorkspaceReviewPanel
          workspacePath={props.workspacePath}
          sessionId={props.sessionId}
          onClose={() => void closeTab(activeTab)}
          embedded
        />
      );
    }
    if (activeTab.kind === "terminal" && activeTab.terminal) {
      return <TerminalPanel terminal={activeTab.terminal} />;
    }
    if (activeTab.kind === "browser") {
      return (
        <BrowserPanel
          sessionId={props.sessionId}
          onClose={() => void closeTab(activeTab)}
        />
      );
    }
    if (activeTab.kind === "files") {
      return (
        <WorkspaceFilesPanel
          client={props.client}
          workspaceId={props.workspaceId}
          workspaceCatalogRoot={props.workspaceCatalogRoot}
          workspacePath={props.workspacePath ?? props.workspaceCatalogRoot}
          fileRoot={props.fileRoot}
          fileTargets={props.fileTargets}
        />
      );
    }
    return null;
  }, [
    activeTab,
    props.client,
    props.sessionId,
    props.workspaceCatalogRoot,
    props.fileRoot,
    props.fileTargets,
    props.workspaceId,
    props.workspacePath,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background" data-code-workspace-side-panel="true">
      <header
        data-panel-titlebar="true"
        className="flex h-12 shrink-0 items-center gap-1 border-b border-dls-mist px-2 mac:titlebar-drag"
      >
        <div
          data-panel-titlebar-controls="true"
          className="min-w-0 flex-1 overflow-x-auto mac:titlebar-no-drag"
        >
          <div className="flex min-w-max items-center gap-1">
            <PanelTabList values={tabs.map((tab) => tab.id)} onReorder={() => undefined}>
              {tabs.map((tab) => {
                const Icon = toolIcon(tab.kind);
                return (
                  <PanelTabItem key={tab.id} value={tab.id} id={tab.id} className="w-40">
                    <div className="relative">
                      <PanelTab active={tab.id === activeId} onClick={() => setActiveId(tab.id)} title={tab.label}>
                        <Icon />
                        <span className="truncate">{tab.label}</span>
                      </PanelTab>
                      <PanelTabClose active={tab.id === activeId} label={tab.label} onClose={() => void closeTab(tab)} />
                    </div>
                  </PanelTabItem>
                );
              })}
            </PanelTabList>
            {tabs.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-xs" aria-label={t("session.browser_new_tab")}><Plus /></Button>}
                />
                <DropdownMenuContent align="start" className="w-48">
                  {visibleToolItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <DropdownMenuItem
                        key={item.kind}
                        onClick={() =>
                          void addTab(
                            item.kind,
                            item.kind === "browser" ? { seedHomeWhenEmpty: true } : undefined,
                          )
                        }
                      >
                        <Icon />
                        {t(item.labelKey)}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          data-code-side-panel-close="true"
          className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          onMouseDown={(event) => event.preventDefault()}
          onClick={props.onClose}
          aria-label={t("session.code_side_panel_close")}
          title={t("session.code_side_panel_close")}
        >
          <PanelRight className="size-3.5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {activeTab ? content : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md space-y-2">
              {visibleToolItems.map((item) => {
                const Icon = item.icon;
                return (
                  <MenuRowButton
                    key={item.kind}
                    type="button"
                    className="h-10 bg-dls-surface-muted text-dls-text hover:bg-dls-hover"
                    onClick={() =>
                      void addTab(
                        item.kind,
                        item.kind === "browser" ? { seedHomeWhenEmpty: true } : undefined,
                      )
                    }
                  >
                    <Icon className="size-4 text-dls-secondary" />
                    {t(item.labelKey)}
                  </MenuRowButton>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
