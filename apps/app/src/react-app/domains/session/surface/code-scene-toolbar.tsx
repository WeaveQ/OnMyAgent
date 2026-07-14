/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AppWindow,
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  FileDiff,
  FolderOpen,
  GitBranch,
  Github,
  Laptop,
  Monitor,
  Radio,
  Terminal,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";
import {
  commitCodeWorkspaceChanges,
  listCodeWorkspaceOpenTargets,
  openCodeWorkspaceTarget,
  pushCodeWorkspaceChanges,
  switchCodeWorkspaceBranch,
} from "../../../../app/lib/desktop";
import type {
  CodeWorkspaceOpenTarget,
  CodeWorkspaceOpenTargetId,
} from "@onmyagent/types";
import { t } from "../../../../i18n";
import {
  CodeWorkspaceDiffView,
  useCodeWorkspaceEnvironment,
} from "./code-workspace-review";

type CodeSceneOpenTargetView = {
  id: CodeWorkspaceOpenTargetId;
  label: string;
  icon: typeof Code2;
  iconSrc?: string;
  available: boolean;
  reason: string | null;
};

const fallbackOpenTargets: CodeSceneOpenTargetView[] = [
  { id: "finder", label: "Finder", icon: FolderOpen, iconSrc: "/editor-icons/finder.png", available: true, reason: null },
  { id: "terminal", label: "Terminal", icon: Terminal, iconSrc: "/editor-icons/terminal.png", available: true, reason: null },
];

const iconByTargetId = new Map<CodeWorkspaceOpenTargetId, typeof Code2>([
  ["vscode", Code2],
  ["cursor", AppWindow],
  ["finder", FolderOpen],
  ["terminal", Terminal],
  ["xcode", AppWindow],
  ["android-studio", Monitor],
]);

const iconAssetByTargetId = new Map<CodeWorkspaceOpenTargetId, string>([
  ["vscode", "/editor-icons/vscode.png"],
  ["cursor", "/editor-icons/cursor.png"],
  ["finder", "/editor-icons/finder.png"],
  ["terminal", "/editor-icons/terminal.png"],
  ["xcode", "/editor-icons/xcode.png"],
  ["android-studio", "/editor-icons/android-studio.png"],
]);

function openTargetView(target: CodeWorkspaceOpenTarget): CodeSceneOpenTargetView {
  return {
    id: target.id,
    label: target.label,
    icon: iconByTargetId.get(target.id) ?? Code2,
    iconSrc: iconAssetByTargetId.get(target.id),
    available: target.available,
    reason: target.reason,
  };
}

function OpenTargetMenuIcon(props: { target: CodeSceneOpenTargetView }) {
  const Icon = props.target.icon;
  if (props.target.iconSrc) {
    return (
      <img
        src={resolvePublicAssetUrl(props.target.iconSrc)}
        alt=""
        className="size-4 shrink-0 object-contain"
        loading="lazy"
      />
    );
  }
  return <Icon className="size-4 text-dls-secondary" />;
}

export function CodeSceneToolbar(props: {
  workspacePath: string | null;
  sessionId: string;
  draftOnly: boolean;
}) {
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const [openTargets, setOpenTargets] = useState<CodeSceneOpenTargetView[]>(fallbackOpenTargets);
  const [openingTargetId, setOpeningTargetId] = useState<CodeWorkspaceOpenTargetId | null>(null);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const hasWorkspace = Boolean(props.workspacePath?.trim());
  const hasSession = !props.draftOnly && Boolean(props.sessionId.trim());
  const environmentActive = environmentOpen || diffOpen || commitOpen;
  const environment = useCodeWorkspaceEnvironment({
    workspacePath: props.workspacePath,
    sessionId: props.sessionId,
    enabled: hasSession,
    polling: environmentActive,
  });

  useEffect(() => {
    let cancelled = false;
    void listCodeWorkspaceOpenTargets()
      .then((result) => {
        if (!cancelled) {
          setOpenTargets(
            result.targets
              .map(openTargetView)
              .filter((target) => target.available),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setOpenTargets(fallbackOpenTargets);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!noticeText) return;
    const timer = window.setTimeout(() => setNoticeText(null), 2600);
    return () => window.clearTimeout(timer);
  }, [noticeText]);

  const availableTargetCount = openTargets.length;
  const git = environment.snapshot?.git;

  const openTarget = async (target: CodeSceneOpenTargetView) => {
    setOpeningTargetId(target.id);
    try {
      const result = await openCodeWorkspaceTarget({
        targetId: target.id,
        workspacePath: props.workspacePath?.trim() ?? "",
      });
      setNoticeText(
        result.ok
          ? t("session.code_toolbar_opened")
          : result.reason ?? t("session.code_toolbar_open_failed"),
      );
    } catch (error) {
      setNoticeText(
        error instanceof Error
          ? error.message
          : t("session.code_toolbar_open_failed"),
      );
    } finally {
      setOpeningTargetId(null);
    }
  };

  const switchBranch = async (branch: string) => {
    if (!props.workspacePath) return;
    setActionBusy(true);
    try {
      const result = await switchCodeWorkspaceBranch({
        workspacePath: props.workspacePath,
        sessionId: props.sessionId,
        branch,
      });
      setBranchOpen(false);
      setNoticeText(
        result.ok
          ? t("session.code_toolbar_branch_switched", { branch })
          : result.reason ?? t("session.code_toolbar_branch_switch_failed"),
      );
      if (result.ok) void environment.refresh();
    } catch (error) {
      setNoticeText(
        error instanceof Error
          ? error.message
          : t("session.code_toolbar_branch_switch_failed"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const commitChanges = async (push: boolean) => {
    if (!props.workspacePath || !commitMessage.trim()) return;
    setActionBusy(true);
    try {
      const result = await commitCodeWorkspaceChanges({
        workspacePath: props.workspacePath,
        sessionId: props.sessionId,
        message: commitMessage.trim(),
        push,
      });
      setNoticeText(
        result.ok
          ? push
            ? t("session.code_toolbar_committed_and_pushed")
            : t("session.code_toolbar_committed")
          : result.reason ?? t("session.code_toolbar_commit_failed"),
      );
      if (result.ok) {
        setCommitMessage("");
        setCommitOpen(false);
        setEnvironmentOpen(false);
      }
      void environment.refresh();
    } catch (error) {
      setNoticeText(
        error instanceof Error
          ? error.message
          : t("session.code_toolbar_commit_failed"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const pushChanges = async () => {
    if (!props.workspacePath) return;
    setActionBusy(true);
    try {
      const result = await pushCodeWorkspaceChanges({
        workspacePath: props.workspacePath,
        sessionId: props.sessionId,
      });
      setNoticeText(
        result.ok
          ? t("session.code_toolbar_pushed")
          : result.reason ?? t("session.code_toolbar_push_failed"),
      );
      if (result.ok) void environment.refresh();
    } catch (error) {
      setNoticeText(
        error instanceof Error
          ? error.message
          : t("session.code_toolbar_push_failed"),
      );
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="relative flex items-center gap-1.5 mac:titlebar-no-drag">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg border-dls-border bg-dls-surface font-medium text-dls-text hover:bg-dls-hover"
              onClick={() => {
                if (!hasWorkspace) setNoticeText(t("session.code_toolbar_choose_workspace_first"));
              }}
              aria-label={t("session.code_toolbar_open_location")}
              title={`${t("session.code_toolbar_available_targets")}: ${availableTargetCount}`}
            >
              <img
                src={resolvePublicAssetUrl("/editor-icons/vscode.png")}
                alt=""
                className="size-4 shrink-0 object-contain"
                loading="lazy"
              />
              <span>{t("session.code_toolbar_open_location")}</span>
              <ChevronDown className="size-3.5 text-dls-secondary" />
            </Button>
          }
        />
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-56 border border-dls-border bg-dls-surface p-2 text-dls-text"
        >
          {openTargets.map((target) => {
            return (
              <DropdownMenuItem
                key={target.id}
                disabled={openingTargetId === target.id}
                onClick={() => void openTarget(target)}
                className="text-dls-text focus:bg-dls-hover focus:text-dls-text"
              >
                <OpenTargetMenuIcon target={target} />
                <span>{target.label}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {hasSession ? (
        <Popover open={environmentOpen} onOpenChange={setEnvironmentOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full text-dls-secondary hover:bg-dls-hover hover:text-dls-text data-[popup-open]:bg-dls-hover data-[popup-open]:text-dls-text"
                aria-label={t("session.code_toolbar_git_controls")}
                title={t("session.code_toolbar_git_controls")}
              >
                <CircleAlert className="size-4" />
              </Button>
            }
          />
          <PopoverContent
            align="end"
            sideOffset={10}
            className="w-80 gap-0 border border-dls-border bg-dls-surface p-4 text-dls-text"
          >
            <div className="flex items-center justify-between gap-3 px-1 pb-3">
              <h3 className="text-sm font-medium text-dls-secondary">
                {t("session.code_toolbar_environment_info")}
              </h3>
              {environment.loading ? (
                <Radio className="size-4 animate-pulse text-dls-secondary" />
              ) : null}
            </div>
            {environment.error ? (
              <div className="px-1 pb-2 text-xs text-dls-status-danger-fg">
                {environment.error}
              </div>
            ) : null}
            <div className="space-y-1">
              <CodeEnvironmentButton
                icon={FileDiff}
                label={t("session.code_toolbar_changes")}
                disabled={!git?.available}
                onClick={() => setDiffOpen(true)}
                trailing={
                  git && (git.additions > 0 || git.deletions > 0) ? (
                    <CodeChangeCount additions={git.additions} deletions={git.deletions} />
                  ) : undefined
                }
              />
              <Popover open={localOpen} onOpenChange={setLocalOpen}>
                <PopoverTrigger
                  render={
                    <CodeEnvironmentButton
                      icon={Laptop}
                      label={t("session.code_toolbar_local")}
                      trailing={<ChevronDown className="size-3.5" />}
                    />
                  }
                />
                <PopoverContent
                  side="left"
                  align="start"
                  sideOffset={10}
                  className="w-64 border border-dls-border bg-dls-surface p-2"
                >
                  <div className="px-3 py-2 text-xs font-medium text-dls-secondary">
                    {t("session.code_toolbar_continue_with")}
                  </div>
                  <CodeMenuRow
                    icon={Laptop}
                    label={t("session.code_toolbar_process_locally")}
                    trailing={<Check className="size-4" />}
                    onClick={() => setLocalOpen(false)}
                  />
                  <CodeMenuRow
                    icon={FolderOpen}
                    label={t("session.code_toolbar_open_workspace")}
                    onClick={() => {
                      const finder = openTargets.find((target) => target.id === "finder");
                      if (finder) void openTarget(finder);
                      setLocalOpen(false);
                    }}
                  />
                  <CodeMenuRow
                    icon={Terminal}
                    label={t("session.code_toolbar_open_terminal")}
                    onClick={() => {
                      const terminal = openTargets.find((target) => target.id === "terminal");
                      if (terminal) void openTarget(terminal);
                      setLocalOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              <Popover open={branchOpen} onOpenChange={setBranchOpen}>
                <PopoverTrigger
                  render={
                    <CodeEnvironmentButton
                      icon={GitBranch}
                      label={git?.branch ?? t("session.code_toolbar_git_unavailable")}
                      disabled={!git?.available}
                      trailing={<ChevronDown className="size-3.5" />}
                    />
                  }
                />
                <PopoverContent
                  side="left"
                  align="start"
                  sideOffset={10}
                  className="w-72 border border-dls-border bg-dls-surface p-2"
                >
                  <div className="px-3 py-2 text-xs font-medium text-dls-secondary">
                    {t("session.code_toolbar_branches")}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {git?.branches.map((branch) => (
                      <CodeMenuRow
                        key={branch}
                        icon={GitBranch}
                        label={branch}
                        disabled={actionBusy}
                        trailing={branch === git.branch ? <Check className="size-4" /> : undefined}
                        onClick={() => void switchBranch(branch)}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <CodeEnvironmentButton
                icon={Radio}
                label={t("session.code_toolbar_commit_or_push")}
                disabled={!git?.available}
                onClick={() => setCommitOpen(true)}
              />
              <CodeEnvironmentButton
                icon={Github}
                label={
                  environment.snapshot?.githubCli.statusLabel ??
                  t("session.code_toolbar_github_cli_unavailable")
                }
                disabled={!environment.snapshot?.githubCli.authenticated}
              />
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      {noticeText ? (
        <div
          role="status"
          className="absolute right-0 top-10 z-60 w-72 rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-xs leading-5 text-dls-secondary ring-1 ring-dls-border/60"
        >
          {noticeText}
        </div>
      ) : null}

      <Sheet open={diffOpen} onOpenChange={setDiffOpen}>
        <SheetContent
          side="right"
          className="w-[min(760px,80vw)] border-dls-border bg-dls-surface sm:max-w-none"
        >
          <SheetHeader className="border-b border-dls-border px-5 py-4">
            <SheetTitle>{t("session.code_toolbar_review_changes")}</SheetTitle>
            <SheetDescription>
              {git?.branch ?? t("session.code_toolbar_git_unavailable")}
              {git ? ` · ${git.changedFiles} · +${git.additions} -${git.deletions}` : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-dls-background p-4">
            <CodeWorkspaceDiffView
              snapshot={environment.snapshot}
              error={environment.error}
              loading={environment.loading}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent className="gap-5 bg-dls-surface sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4 pr-8">
              <DialogTitle>{t("session.code_toolbar_commit_or_push")}</DialogTitle>
              {git ? <CodeChangeCount additions={git.additions} deletions={git.deletions} /> : null}
            </div>
            <DialogDescription>
              {git?.branch ?? t("session.code_toolbar_git_unavailable")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder={t("session.code_toolbar_commit_message")}
            className="min-h-28 resize-none"
          />
          <div className="flex items-center gap-2 text-sm text-dls-text">
            <Check className="size-4 text-dls-accent" />
            {t("session.code_toolbar_include_unstaged")}
          </div>
          <DialogFooter className="flex-row justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={actionBusy || !git?.hasRemote || git.ahead === 0}
              onClick={() => void pushChanges()}
            >
              <UploadCloud className="size-4" />
              {t("session.code_toolbar_push")}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={actionBusy || !commitMessage.trim() || !git?.changedFiles}
                onClick={() => void commitChanges(false)}
              >
                {t("session.code_toolbar_commit")}
              </Button>
              <Button
                type="button"
                disabled={
                  actionBusy ||
                  !commitMessage.trim() ||
                  !git?.changedFiles ||
                  !git.hasRemote
                }
                onClick={() => void commitChanges(true)}
              >
                {t("session.code_toolbar_commit_and_push")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CodeChangeCount(props: { additions: number; deletions: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
      <span className="text-dls-status-success-fg">+{props.additions}</span>
      <span className="text-dls-status-danger-fg">-{props.deletions}</span>
    </span>
  );
}

function CodeEnvironmentButton(props: {
  icon: typeof Code2;
  label: string;
  trailing?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex min-h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium text-dls-text hover:bg-dls-hover disabled:cursor-default disabled:text-dls-secondary"
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.trailing ? (
        <span className="shrink-0 text-dls-secondary">{props.trailing}</span>
      ) : null}
    </button>
  );
}

function CodeMenuRow(props: {
  icon: typeof Code2;
  label: string;
  trailing?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex min-h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-dls-text hover:bg-dls-hover disabled:text-dls-secondary"
    >
      <Icon className="size-4 shrink-0 text-dls-secondary" />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.trailing ? <span className="shrink-0">{props.trailing}</span> : null}
    </button>
  );
}
