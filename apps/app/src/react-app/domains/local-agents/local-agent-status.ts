import type { PersonalLocalAgentStatus } from "../../../app/lib/desktop";
import type { StatusBadgeTone } from "@/components/ui/status-badge";
import { t } from "@/i18n";

// Status descriptor for Local Agent availability and diagnostic state.
export type LocalAgentStatusDescriptor = {
  status: PersonalLocalAgentStatus;
  tone: StatusBadgeTone;
  /** Tailwind classes for the status dot (matches the design system tokens). */
  dotClass: string;
  label: string;
};

export function localAgentStatusDescriptor(
  status: PersonalLocalAgentStatus,
  error?: string | null,
): LocalAgentStatusDescriptor {
  switch (status) {
    case "online":
      return { status, tone: "success", dotClass: "bg-dls-online", label: t("local_agent.status_online") };
    case "needs_auth":
      return { status, tone: "warning", dotClass: "bg-dls-status-warning", label: t("local_agent.status_needs_auth") };
    case "offline":
      return { status, tone: "danger", dotClass: "bg-dls-status-danger", label: t("local_agent.status_offline") };
    case "missing":
      return { status, tone: "danger", dotClass: "bg-dls-status-danger", label: t("local_agent.status_missing_agent") };
    case "unknown":
    default:
      return { status: "unknown", tone: "neutral", dotClass: "bg-dls-secondary", label: error || t("local_agent.status_unknown") };
  }
}
