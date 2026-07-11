/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusPing } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { usePlatform } from "../../../../kernel/platform";
import {
  useControlAction,
  type OnMyAgentControlAction,
} from "../../../../shell";
import type { OnMyAgentServerStatus } from "../../../../../app/lib/onmyagent-server";
import { APP_NAME } from "../../../../../i18n/locales/brand";

const DOCS_URL = "https://onmyagentlabs.com/docs";
const STATUS_BAR_BOOT_STARTED_AT = Date.now();
const STATUS_BAR_INITIALIZING_MS = 15_000;

type StatusDotVariant = "connected" | "loading" | "partial" | "disconnected";

type StatusDotProps = {
  variant: StatusDotVariant;
};

function StatusDot({ variant }: StatusDotProps) {
  if (variant === "loading") {
    return <StatusPing size="status" tone="warning" glow="soft" />;
  }

  return (
    <span className="relative flex size-2.5 shrink-0 items-center justify-center">
      <span
        className={cn(
          "relative inline-flex size-2.5 rounded-full",
          variant === "connected" && "bg-dls-accent",
          variant === "partial" && "bg-dls-status-warning",
          variant === "disconnected" && "bg-dls-status-danger",
        )}
      />
    </span>
  );
}

type StatusIndicatorProps = {
  clientConnected: boolean;
  onmyagentServerStatus: OnMyAgentServerStatus;
  developerMode: boolean;
  mcpConnectedCount: number;
  loading?: boolean;
  initializing: boolean;
};

function StatusIndicator(props: StatusIndicatorProps) {
  if (
    props.loading ||
    (props.onmyagentServerStatus === "disconnected" && props.initializing)
  ) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot variant="loading" />
        <span className="shrink-0 font-medium text-dls-text text-xs">
          {t("session.preparing_workspace")}
        </span>
        <span className="truncate text-dls-secondary text-xs">
          {t("session.loading_detail")}
        </span>
      </div>
    );
  }

  if (props.clientConnected) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <StatusDot variant="connected" />
          </TooltipTrigger>
          <TooltipContent>{t("status.connected")}</TooltipContent>
        </Tooltip>
        <span className="truncate text-dls-secondary text-xs">
          {props.mcpConnectedCount > 0
            ? t("status.mcp_connected", undefined, {
                count: props.mcpConnectedCount,
              })
            : t("status.ready_for_tasks")}
        </span>
        {props.developerMode ? (
          <span className="truncate text-dls-secondary text-xs">
            {t("status.developer_mode")}
          </span>
        ) : null}
      </div>
    );
  }

  if (props.onmyagentServerStatus === "limited") {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot variant="partial" />
        <span className="shrink-0 font-medium text-dls-text text-xs">
          {t("status.limited_mode")}
        </span>
        <span className="truncate text-dls-secondary text-xs">
          {props.mcpConnectedCount > 0
            ? t("status.limited_mcp_hint", undefined, {
                count: props.mcpConnectedCount,
              })
            : t("status.limited_hint")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <StatusDot variant="disconnected" />
      <span className="shrink-0 font-medium text-dls-text text-xs">
        {t("status.disconnected_label")}
      </span>
      <span className="truncate text-dls-secondary text-xs">
        {t("status.disconnected_hint")}
      </span>
    </div>
  );
}

export type StatusBarProps = {
  clientConnected: boolean;
  onmyagentServerStatus: OnMyAgentServerStatus;
  developerMode: boolean;
  settingsOpen: boolean;
  onSendFeedback: () => void;
  onOpenSettings: () => void;
  providerConnectedIds: string[];
  mcpConnectedCount: number;
  loading?: boolean;
  showSettingsButton?: boolean;
  initializing?: boolean;
};

export function StatusBar(props: StatusBarProps) {
  const platform = usePlatform();
  const docsButtonRef = useRef<HTMLButtonElement>(null);
  const feedbackButtonRef = useRef<HTMLButtonElement>(null);
  const [initializing, setInitializing] = useState(
    () => Date.now() - STATUS_BAR_BOOT_STARTED_AT < STATUS_BAR_INITIALIZING_MS,
  );

  useEffect(() => {
    if (!initializing) return;
    const remaining = Math.max(
      0,
      STATUS_BAR_INITIALIZING_MS - (Date.now() - STATUS_BAR_BOOT_STARTED_AT),
    );
    const timeout = window.setTimeout(() => setInitializing(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [initializing]);

  const docsControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "status.docs.open",
      label: `Open ${APP_NAME} docs`,
      description: t("status.open_docs_desc"),
      sideEffect: "external",
      targetRef: docsButtonRef,
      execute: () => platform.openLink(DOCS_URL),
    }),
    [platform],
  );
  useControlAction(docsControlAction);

  const feedbackControlAction = useMemo<OnMyAgentControlAction>(
    () => ({
      id: "status.feedback.open",
      label: t("status.send_feedback"),
      description: t("status.send_feedback_desc"),
      sideEffect: "external",
      targetRef: feedbackButtonRef,
      execute: props.onSendFeedback,
    }),
    [props.onSendFeedback],
  );
  useControlAction(feedbackControlAction);

  return (
    <div className="border-t border-dls-border bg-dls-surface">
      <div className="flex h-8 items-center justify-between gap-3 px-4 md:px-6">
        <StatusIndicator
          clientConnected={props.clientConnected}
          onmyagentServerStatus={props.onmyagentServerStatus}
          developerMode={props.developerMode}
          mcpConnectedCount={props.mcpConnectedCount}
          loading={props.loading}
          initializing={initializing}
        />
        <div className="flex items-center gap-1">
          {/* {shellConfig.docsButton ? (
            <Button
              ref={docsButtonRef}
              className="text-dls-secondary gap-2"
              variant="ghost"
              size="xs"
              onClick={() => platform.openLink(DOCS_URL)}
              title={t("status.open_docs")}
              aria-label={t("status.open_docs")}
            >
              <BookOpen className="size-3.5" />
              <span>{t("status.docs")}</span>
            </Button>
          ) : null} */}
          {/* {shellConfig.feedbackButton ? (
            <Button
              ref={feedbackButtonRef}
              className="text-dls-secondary gap-2"
              variant="ghost"
              size="xs"
              onClick={props.onSendFeedback}
              title={t("status.send_feedback")}
              aria-label={t("status.send_feedback")}
            >
              <MessageCircleMore className="size-3.5" />
              <span>{t("status.feedback")}</span>
            </Button>
          ) : null} */}
        </div>
      </div>
    </div>
  );
}
