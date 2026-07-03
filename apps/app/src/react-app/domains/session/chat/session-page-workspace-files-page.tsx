/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { t } from "../../../../i18n";
import { openDesktopPath } from "../../../../app/lib/desktop";
import type {
  OpenworkServerClient,
  OpenworkWorkspaceFileCatalogEntry,
} from "../../../../app/lib/onmyagent-server";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { MenuRowButton, NavListButton, NavTabButton, SegmentedTabGroup, TreeRowButton } from "@/components/ui/action-row";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

import {
  buildFileHierarchy,
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  filterWorkspaceFileTree,
  findWorkspaceFileNode,
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
  shouldHideEntry,
  workspaceNameFromRoot,
  type WorkspaceFileTreeNode,
} from "./session-page-files-model";

const CLOUD_DRIVE_PLACEHOLDER_ASSET = "/empty-states/cloud-drive-placeholder.png";

function CloudDriveEmptyState() {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center px-6 py-12 text-center">
      <div className="flex w-full max-w-xl flex-col items-center">
        <img
          src={resolvePublicAssetUrl(CLOUD_DRIVE_PLACEHOLDER_ASSET)}
          alt=""
          loading="lazy"
          className="h-auto w-full max-w-[360px]"
        />
        <h1 className="mt-7 text-lg font-medium text-dls-text">
          {t("files.cloud_empty_title")}
        </h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-dls-secondary">
          {t("files.cloud_empty_description")}
        </p>
      </div>
    </div>
  );
}

export function WorkspaceFilesPage(props: {
  client: OpenworkServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  fileRoot?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<OpenworkWorkspaceFileCatalogEntry[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"task" | "cloud">("task");
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(
    () => new Set(),
  );
  const fileRoot =
    props.fileRoot === undefined ? props.workspaceRoot : props.fileRoot?.trim() ?? "";
  const hasScopedFileRoot = props.fileRoot !== undefined && Boolean(fileRoot);
  const requiresSessionFileRoot = props.fileRoot !== undefined;

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || !fileRoot.trim()) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void props.client
      .listWorkspaceFiles(props.workspaceId, {
        includeDirs: true,
        limit: 5000,
        ...(hasScopedFileRoot ? { root: fileRoot } : {}),
      })
      .then((catalog) => {
        if (cancelled) return;
        setEntries(catalog.items);
        setExpandedAgents((prev) => {
          if (prev.size > 0) return prev;
          const next = new Set(prev);
          const filtered = catalog.items.filter(
            (e) => !shouldHideEntry(e.path),
          );
          const rawTree = buildWorkspaceFileTree(filtered);
          const tree = filterHiddenFromTree(rawTree);
          for (const child of tree.children.slice(0, 5)) {
            next.add(child.name);
          }
          return next;
        });
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error ? loadError.message : "文件列表加载失败",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileRoot, hasScopedFileRoot, props.client, props.workspaceId, refreshKey]);

  const taskGroups = useMemo(() => {
    const filtered = entries.filter((e) => !shouldHideEntry(e.path));
    let groups = buildFileHierarchy(filtered);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      groups = groups.filter(
        (g) =>
          g.agentName.toLowerCase().includes(q) ||
          g.taskName.toLowerCase().includes(q) ||
          g.files.some(
            (f) =>
              f.name.toLowerCase().includes(q) ||
              f.path.toLowerCase().includes(q),
          ),
      );
      groups = groups.map((g) => ({
        ...g,
        files: g.files.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.path.toLowerCase().includes(q) ||
            g.agentName.toLowerCase().includes(q) ||
            g.taskName.toLowerCase().includes(q),
        ),
      }));
    }
    return groups;
  }, [entries, query]);

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      const absolutePath = filePath.startsWith("/")
        ? filePath
        : `${fileRoot}/${filePath}`;
      try {
        await openDesktopPath(absolutePath);
      } catch (openError) {
        console.error("Failed to open file:", openError);
      }
      setMenuPath(null);
    },
    [fileRoot],
  );

  const toggleAgent = (name: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleTask = (key: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-surface text-dls-text">
      {activeTab === "task" && (
      <div className="shrink-0 border-b border-border bg-dls-surface px-12 py-6">
        <h1 className="text-lg font-medium text-foreground">
          {t("files.title")}
        </h1>
        <p className="mt-2 text-sm text-dls-secondary">
          {t("files.description")}
        </p>
      </div>
      )}

      <div className="shrink-0 border-b border-border px-6">
        <div className="flex gap-6">
          <NavTabButton
            type="button"
            onClick={() => setActiveTab("task")}
            active={activeTab === "task"}
            className="relative rounded-none bg-transparent py-3 text-sm font-medium data-[active=true]:bg-transparent"
            data-active={activeTab === "task"}
          >
            <Folder className="size-4" />
            {t("files.task_results")}
            {activeTab === "task" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
            )}
          </NavTabButton>
          <NavTabButton
            type="button"
            onClick={() => setActiveTab("cloud")}
            active={activeTab === "cloud"}
            className="relative rounded-none bg-transparent py-3 text-sm font-medium data-[active=true]:bg-transparent"
            data-active={activeTab === "cloud"}
          >
            <Cloud className="size-4" />
            {t("files.cloud_drive")}
            {activeTab === "cloud" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
            )}
          </NavTabButton>
        </div>
      </div>

      {activeTab === "cloud" ? null : (
      <div className="shrink-0 flex items-center gap-3 border-b border-border px-6 py-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
        >
          <SlidersHorizontal data-icon="inline-start" className="size-4" />
          {t("files.category_all")}
          <ChevronDown className="size-3.5" />
        </Button>
        <InputGroup radius="lg" className="flex-1">
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={t("files.search_placeholder")}
          />
          <InputGroupAddon align="inline-start">
            <Search className="size-4 text-dls-secondary" />
          </InputGroupAddon>
        </InputGroup>
      </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === "cloud" ? (
          <CloudDriveEmptyState />
        ) : loading && entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-dls-secondary">
            {t("files.loading")}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-dls-secondary">
            {error}
          </div>
        ) : taskGroups.length > 0 ? (
          <div className="py-2">
            {taskGroups.map((group) => {
              const agentExpanded = expandedAgents.has(group.agentName);
              const taskKey = `${group.agentName}/${group.taskName}`;
              const taskExpanded = expandedTasks.has(taskKey);
              return (
                <div key={taskKey}>
                  <TreeRowButton
                    type="button"
                    onClick={() => toggleAgent(group.agentName)}
                    className="px-6 text-foreground hover:bg-muted/50"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 transition-transform",
                        agentExpanded && "rotate-90",
                      )}
                    />
                    <Bot className="size-4 shrink-0 text-dls-secondary" />
                    <span className="truncate">{group.agentName}</span>
                    <span className="shrink-0 text-xs text-dls-secondary">
                      {
                        entries.filter(
                          (e) =>
                            !shouldHideEntry(e.path) &&
                            e.path.startsWith(group.agentName + "/") &&
                            e.kind === "file",
                        ).length
                      }{" "}
                      {t("files.files_unit")}
                    </span>
                  </TreeRowButton>

                  {agentExpanded && (
                    <>
                      <TreeRowButton
                        type="button"
                        depth="child"
                        onClick={() => toggleTask(taskKey)}
                        className="px-10 text-foreground hover:bg-muted/50"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3 shrink-0 transition-transform",
                            taskExpanded && "rotate-90",
                          )}
                        />
                        <Folder className="size-3.5 shrink-0 text-dls-status-warning" />
                        <span className="truncate">{group.taskName}</span>
                        <span className="shrink-0 text-xs text-dls-secondary">
                          {t("files.file_count", { count: group.files.length })}
                        </span>
                      </TreeRowButton>

                      {taskExpanded && (
                        <>
                          {group.files.map((file) => (
                            <div
                              key={file.path}
                              className="group relative flex items-center px-14 py-1.5 text-sm hover:bg-muted/50"
                            >
                              <FileText className="size-3.5 shrink-0 text-dls-secondary" />
                              <span className="ml-2 truncate">{file.name}</span>
                              <span className="ml-4 shrink-0 text-xs text-dls-secondary">
                                {formatWorkspaceFileSize(file.size)}
                              </span>
                              <span className="ml-2 shrink-0 text-xs text-dls-secondary">
                                {formatWorkspaceFileTime(file.mtimeMs)}
                              </span>
                              <div className="absolute right-6 hidden group-hover:flex items-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => setMenuPath(file.path)}
                                  className="text-dls-secondary"
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </div>
                              {menuPath === file.path && (
                                <div className="absolute right-6 top-0 z-20 flex flex-col rounded-lg border border-border bg-dls-surface py-1">
                                  <MenuRowButton
                                    align="center"
                                    type="button"
                                    onClick={() => handleOpenFile(file.path)}
                                  >
                                    {t("files.open_file")}
                                  </MenuRowButton>
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-dls-secondary">
            {requiresSessionFileRoot ? t("files.no_session_files") : t("files.no_files")}
          </div>
        )}
      </div>

      {menuPath && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setMenuPath(null)}
          onContextMenu={() => setMenuPath(null)}
        />
      )}
    </div>
  );
}

function WorkspaceFileTreeRow(props: {
  node: WorkspaceFileTreeNode;
  level: number;
  selectedPath: string;
  expandedPaths: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const isDirectory = props.node.kind === "dir";
  const expanded = props.expandedPaths.has(props.node.path);
  const selected = props.selectedPath === props.node.path;
  const Icon = isDirectory ? (expanded ? FolderOpen : Folder) : FileText;

  return (
    <div>
      <NavListButton
        type="button"
        size="compact"
        onClick={() => {
          props.onSelect(props.node.path);
          if (isDirectory) props.onToggle(props.node.path);
        }}
        active={selected}
        className="h-9 rounded-lg pr-3 text-sm"
        style={{ paddingLeft: 10 + props.level * 16 }}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-dls-secondary transition-transform",
            !isDirectory && "opacity-0",
            expanded && "rotate-90",
          )}
        />
        <Icon
          className={cn(
            "size-4 shrink-0",
            isDirectory ? "text-dls-status-warning" : "text-dls-secondary",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{props.node.name}</span>
        {props.node.kind === "file" ? (
          <span className="shrink-0 text-xs text-dls-secondary">
            {formatWorkspaceFileSize(props.node.size)}
          </span>
        ) : null}
      </NavListButton>
      {isDirectory && expanded ? (
        <div>
          {props.node.children.map((child) => (
            <WorkspaceFileTreeRow
              key={child.path}
              node={child}
              level={props.level + 1}
              selectedPath={props.selectedPath}
              expandedPaths={props.expandedPaths}
              onSelect={props.onSelect}
              onToggle={props.onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
