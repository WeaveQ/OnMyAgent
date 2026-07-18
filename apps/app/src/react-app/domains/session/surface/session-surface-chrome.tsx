/** @jsxImportSource react */
/**
 * Session surface chrome — header, draft-home title, draft workspace accessory.
 * Extracted from session-surface.tsx (mechanical UI move).
 */
import type { ReactNode } from "react";
import {
  ChevronDown,
  Folder,
  FolderOpen,
  Settings2,
  X,
} from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AccessPermissionSelect } from "./composer/access-permission-select";
import type { ComposerAccessMode } from "../../../../app/types";
import {
  AssistantDraftHomeMark,
  PendingAgentAvatar,
} from "./chrome/avatars";
import { sessionSurfaceTextClass } from "./surface-styles";
import type { AssistantCategoryId } from "./personal-assistant-config";

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
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between bg-dls-background px-5">
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
    <div className="mb-6 flex flex-col items-center text-center">
      <div className="flex items-center gap-2.5 text-dls-text">
        <AssistantDraftHomeMark categoryId={props.categoryId} />
        <h2 className={sessionSurfaceTextClass.draftHomeTitle}>{props.title}</h2>
      </div>
      {props.subtitle ? (
        <p className={sessionSurfaceTextClass.draftHomeSubtitle}>{props.subtitle}</p>
      ) : null}
    </div>
  );
}

export function SessionDraftWorkspaceAccessory(props: {
  draftWorkspaceDirectory?: string | null;
  assistantFeatureCategoryId?: AssistantCategoryId;
  showFolderRequiredBubble: boolean;
  onDismissFolderRequiredBubble: () => void;
  onPickDraftWorkspace?: () => void;
  onClearDraftWorkspace?: () => void;
  accessMode: ComposerAccessMode;
  onAccessModeChange: (mode: ComposerAccessMode) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-0.5 text-xs font-normal leading-none text-dls-secondary">
      <div className="relative inline-flex min-w-0 items-center">
        {props.showFolderRequiredBubble ? (
          <div className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg border border-dls-accent/30 bg-dls-surface px-3 py-2 text-xs leading-5 text-dls-text">
            <div className="font-medium text-dls-accent">
              {t("session.choose_folder_required_title")}
            </div>
            <div className="mt-0.5 text-dls-secondary">
              {t("session.choose_folder_required_desc")}
            </div>
            <div className="absolute -bottom-1 left-5 size-2 rotate-45 border-b border-r border-dls-accent/30 bg-dls-surface" />
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            props.onDismissFolderRequiredBubble();
            props.onPickDraftWorkspace?.();
          }}
          className={cn(
            "h-8 justify-start gap-1.5 rounded-lg px-2 text-left text-xs font-normal leading-none hover:bg-dls-hover hover:text-dls-text [&_svg]:size-3.5",
            props.draftWorkspaceDirectory
              ? "text-dls-secondary"
              : props.assistantFeatureCategoryId === "code"
                ? "animate-pulse bg-dls-accent/10 text-dls-accent hover:bg-dls-accent/10 hover:text-dls-accent"
                : "text-dls-secondary",
          )}
        >
          {props.draftWorkspaceDirectory ? (
            <>
              <FolderOpen className="size-3.5 shrink-0" />
              <span className="max-w-56 truncate text-dls-text">
                {props.draftWorkspaceDirectory
                  .replace(/\\/g, "/")
                  .replace(/\/+$/, "")
                  .split("/")
                  .filter(Boolean)
                  .pop()}
              </span>
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
        </Button>
        {props.draftWorkspaceDirectory ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={props.onClearDraftWorkspace}
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
    </div>
  );
}
