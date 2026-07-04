/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import type { PersonalLocalAgentConversationMessage } from "../../../../app/lib/desktop";

export function MessageTips(props: {
  message: PersonalLocalAgentConversationMessage;
  onResolve?: (message: PersonalLocalAgentConversationMessage) => void;
}) {
  const tone = props.message.category === "error" ? "error" : props.message.category === "warning" ? "warning" : "info";
  const resolution = props.message.resolution;
  return (
    <NoticeBox tone={tone}>
      <span>{props.message.text}</span>
      {props.message.ownership ? <StatusBadge size="tiny" tone="surface" className="ml-2 font-mono">{props.message.ownership}</StatusBadge> : null}
      {resolution?.message ? <span className="ml-2 text-dls-secondary">{resolution.message}</span> : null}
      {resolution ? (
        <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => props.onResolve?.(props.message)} data-testid="local-agent-tips-resolution">
          {t("local_agent.tips_resolve")}
        </Button>
      ) : null}
    </NoticeBox>
  );
}
