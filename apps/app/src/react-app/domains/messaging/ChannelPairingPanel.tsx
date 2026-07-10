/** @jsxImportSource react */
import { useState, useEffect, useCallback } from "react";
import { Check, X, UserPlus, Users, RefreshCw, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  channelGetPendingPairingRequests,
  channelGetAuthorizedUsers,
  channelApprovePairing,
  channelDenyPairing,
  channelRevokeUserAuthorization,
  channelGetSessionsByPlatform,
  type ChannelPairingRequest,
  type ChannelAuthorizedUser,
  type ChannelSession,
} from "../../../app/lib/desktop";
import { t } from "../../../i18n";

function shortDate(value: number | undefined): string {
  if (!value) return "--";
  return new Date(value).toLocaleString();
}

function sessionsForUser(sessions: ChannelSession[], user: ChannelAuthorizedUser): ChannelSession[] {
  return sessions.filter((session) => session.platformType === user.platformType && session.platformUserId === user.platformUserId);
}

/**
 * Format time remaining for pairing requests
 */
function formatTimeRemaining(expiresAt: number): string {
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return t("session.channel_pairing_expired");
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  if (minutes > 0) return t("session.channel_pairing_time_ms", { minutes, seconds });
  return t("session.channel_pairing_time_s", { seconds });
}

/**
 * Pairing Request Card Component
 */
function PairingRequestCard(props: {
  request: ChannelPairingRequest;
  onApprove: (code: string) => void;
  onDeny: (code: string) => void;
  isProcessing: boolean;
}) {
  const { request, onApprove, onDeny, isProcessing } = props;
  const isExpired = request.expiresAt < Date.now();

  return (
    <div className={cn(
      "rounded-lg border bg-dls-card p-3",
      isExpired ? "border-dls-border opacity-50" : "border-dls-border"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dls-accent/10">
            <UserPlus className="size-5 text-dls-accent" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-semibold text-dls-text">
                {request.code}
              </span>
              <StatusBadge tone="neutral" size="sm">
                {request.platformType}
              </StatusBadge>
            </div>
            <p className="mt-0.5 truncate text-xs text-dls-secondary">
              {request.displayName || request.platformUserId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="destructive"
            size="sm"
            disabled={isProcessing || isExpired}
            onClick={() => onDeny(request.code)}
          >
            <X className="size-4" />
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={isProcessing || isExpired}
            onClick={() => onApprove(request.code)}
          >
            <Check className="size-4" />
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-dls-secondary">
        <span>{t("session.channel_pairing_time_left", { value: formatTimeRemaining(request.expiresAt) })}</span>
      </div>
    </div>
  );
}

/**
 * Authorized User Card Component
 */
function AuthorizedUserCard(props: {
  user: ChannelAuthorizedUser;
  sessions: ChannelSession[];
  onRevoke: (platformType: string, platformUserId: string) => void;
  isProcessing: boolean;
}) {
  const { user, sessions, onRevoke, isProcessing } = props;
  const activeSessions = sessions.filter((session) => !session.closedAt);
  const latestSession = [...sessions].sort((a, b) => Number(b.lastActivity ?? 0) - Number(a.lastActivity ?? 0))[0];

  return (
    <div className="rounded-lg border border-dls-border bg-dls-card p-3">
      <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dls-surface">
          <Users className="size-5 text-dls-secondary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-dls-text">
              {user.displayName || user.platformUserId}
            </span>
              <StatusBadge tone="accent" size="sm">
              {user.platformType}
            </StatusBadge>
          </div>
          <p className="mt-0.5 truncate text-xs text-dls-secondary">
            {t("session.channel_pairing_last_active", { value: shortDate(user.lastActive || user.authorizedAt) })}
          </p>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={isProcessing}
        onClick={() => onRevoke(user.platformType, user.platformUserId)}
      >
        {t("session.channel_pairing_revoke")}
      </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-dls-border bg-dls-surface px-2 py-1.5">
          <div className="text-dls-secondary">{t("session.channel_pairing_metric_active")}</div>
          <div className="mt-1 font-medium text-dls-text">{activeSessions.length}</div>
        </div>
        <div className="rounded-lg border border-dls-border bg-dls-surface px-2 py-1.5">
          <div className="text-dls-secondary">{t("session.channel_pairing_metric_agent")}</div>
          <div className="mt-1 truncate font-medium text-dls-text">{latestSession?.agentType || "--"}</div>
        </div>
        <div className="rounded-lg border border-dls-border bg-dls-surface px-2 py-1.5">
          <div className="text-dls-secondary">{t("session.channel_pairing_metric_recent")}</div>
          <div className="mt-1 truncate font-medium text-dls-text">{shortDate(latestSession?.lastActivity)}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Channel Pairing Panel
 * Displays pending pairing requests and authorized users
 */
export function ChannelPairingPanel() {
  const [pendingRequests, setPendingRequests] = useState<ChannelPairingRequest[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<ChannelAuthorizedUser[]>([]);
  const [channelSessions, setChannelSessions] = useState<ChannelSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [processingCode, setProcessingCode] = useState<string | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [requests, users, wechatSessions, feishuSessions] = await Promise.all([
        channelGetPendingPairingRequests(),
        channelGetAuthorizedUsers(),
        channelGetSessionsByPlatform("wechat"),
        channelGetSessionsByPlatform("feishu"),
      ]);
      setPendingRequests(requests);
      setAuthorizedUsers(users);
      setChannelSessions([...wechatSessions, ...feishuSessions]);
    } catch (error) {
      console.error("[ChannelPairingPanel] Failed to load data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load and periodic refresh
  useEffect(() => {
    void loadData();
    const interval = setInterval(loadData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle approve pairing
  const handleApprove = async (code: string) => {
    setProcessingCode(code);
    try {
      const result = await channelApprovePairing(code);
      if (result.ok) {
        await loadData();
      } else {
        console.error("[ChannelPairingPanel] Failed to approve pairing:", result.error);
      }
    } finally {
      setProcessingCode(null);
    }
  };

  // Handle deny pairing
  const handleDeny = async (code: string) => {
    setProcessingCode(code);
    try {
      const result = await channelDenyPairing(code);
      if (result.ok) {
        await loadData();
      } else {
        console.error("[ChannelPairingPanel] Failed to deny pairing:", result.error);
      }
    } finally {
      setProcessingCode(null);
    }
  };

  // Handle revoke authorization
  const handleRevoke = async (platformType: string, platformUserId: string) => {
    setProcessingCode(`${platformType}:${platformUserId}`);
    try {
      const result = await channelRevokeUserAuthorization(platformType, platformUserId);
      if (result.ok) {
        await loadData();
      } else {
        console.error("[ChannelPairingPanel] Failed to revoke authorization:", result.error);
      }
    } finally {
      setProcessingCode(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Pending Pairing Requests */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-dls-text">{t("session.channel_pairing_pending_title")}</h4>
            {pendingRequests.length > 0 && (
              <StatusBadge tone="warning" size="sm">
                {pendingRequests.length}
              </StatusBadge>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadData}
            disabled={isLoading}
          >
            <RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
          </Button>
        </div>

        {pendingRequests.length === 0 ? (
          <div className="rounded-lg border border-dls-border bg-dls-muted/50 p-6 text-center">
            <p className="text-sm text-dls-secondary">{t("session.channel_pairing_pending_empty")}</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {pendingRequests.map((request) => (
              <PairingRequestCard
                key={request.code}
                request={request}
                onApprove={handleApprove}
                onDeny={handleDeny}
                isProcessing={processingCode === request.code}
              />
            ))}
          </div>
        )}
      </div>

      {/* Authorized Users */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-dls-secondary" />
            <h4 className="text-sm font-medium text-dls-text">{t("session.channel_pairing_authorized_title")}</h4>
            <StatusBadge tone="accent" size="sm">
              {authorizedUsers.length}
            </StatusBadge>
          </div>
        </div>

        {authorizedUsers.length === 0 ? (
          <div className="rounded-lg border border-dls-border bg-dls-muted/50 p-6 text-center">
            <p className="text-sm text-dls-secondary">{t("session.channel_pairing_authorized_empty")}</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {authorizedUsers.map((user) => (
              <AuthorizedUserCard
                key={`${user.platformType}:${user.platformUserId}`}
                user={user}
                sessions={sessionsForUser(channelSessions, user)}
                onRevoke={handleRevoke}
                isProcessing={processingCode === `${user.platformType}:${user.platformUserId}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
