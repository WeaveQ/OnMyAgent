/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import type { PersonalLocalAgentConversationMessage } from "../../../../app/lib/desktop";

const EMPTY_ASSISTANT_RE =
  /without assistant text|completed without assistant|no assistant text|empty_output/i;

function isEmptyAssistantFailure(text: string, category?: string | null) {
  return category === "error" && EMPTY_ASSISTANT_RE.test(text);
}

function isAcpPromptFailure(text: string, category?: string | null) {
  if (category !== "error") return false;
  return /session\/prompt|session\/new/i.test(text) || /acp.*(prompt|session).*(fail|error|internal)/i.test(text);
}

function localizeTipText(text: string, category?: string | null) {
  if (isEmptyAssistantFailure(text, category)) {
    return t("local_agent.failure_empty_output", { message: text });
  }
  if (isAcpPromptFailure(text, category)) {
    return t("local_agent.failure_acp_prompt", { message: text });
  }
  return text;
}

function ownershipLabel(
  ownership?: string | null,
  text?: string,
  category?: string | null,
) {
  // Re-classify empty ACP / session-prompt failures on the client so stale tips
  // stored with ownership=provider still show Agent, not 服务.
  const resolved =
    isEmptyAssistantFailure(text ?? "", category) || isAcpPromptFailure(text ?? "", category)
      ? "agent"
      : ownership;
  if (!resolved) return null;
  if (resolved === "agent") return t("local_agent.tips_ownership_agent");
  if (resolved === "provider") return t("local_agent.tips_ownership_provider");
  if (resolved === "platform") return t("local_agent.tips_ownership_platform");
  if (resolved === "unknown") return null;
  return resolved;
}

export function MessageTips(props: {
  message: PersonalLocalAgentConversationMessage;
  onResolve?: (message: PersonalLocalAgentConversationMessage) => void;
}) {
  const tone = props.message.category === "error" ? "error" : props.message.category === "warning" ? "warning" : "info";
  const resolution = props.message.resolution;
  const ownership = ownershipLabel(
    props.message.ownership,
    props.message.text,
    props.message.category,
  );
  // Tips already carry the failure text — don't repeat resolution.message when
  // identical or when it's the raw English twin of a localized empty-output tip.
  const resolutionExtra =
    resolution?.message
    && resolution.message.trim() !== props.message.text.trim()
    && !isEmptyAssistantFailure(resolution.message, "error")
      ? resolution.message
      : null;
  const primary = localizeTipText(props.message.text, props.message.category);
  const showRawDetail =
    resolutionExtra
    || (
      isAcpPromptFailure(props.message.text, props.message.category)
      && primary !== props.message.text.trim()
    );
  const detailText = resolutionExtra
    ?? (showRawDetail ? props.message.text.trim() : null);

  return (
    <NoticeBox tone={tone} className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 text-sm leading-5">{primary}</span>
      {ownership ? (
        <StatusBadge size="tiny" tone="surface">
          {ownership}
        </StatusBadge>
      ) : null}
      {detailText && detailText !== primary ? (
        <span className="basis-full text-xs leading-4 text-dls-secondary">{detailText}</span>
      ) : null}
      {resolution ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => props.onResolve?.(props.message)}
          data-testid="local-agent-tips-resolution"
        >
          {t("local_agent.tips_resolve")}
        </Button>
      ) : null}
    </NoticeBox>
  );
}
