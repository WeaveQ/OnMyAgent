/** @jsxImportSource react */
import {
  Box,
  Bot,
  Bug,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  Database,
  Eye,
  Folder,
  Globe,
  Image as ImageIcon,
  PanelsTopLeft,
  Pencil,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";

import { SkillGlyphIcon } from "../../../../design-system/skill-glyph-icon";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export function ToolActivityIcon(props: { category?: string }) {
  const className = "size-4 shrink-0 text-dls-secondary";
  switch (props.category) {
    case "skill":
      return <SkillGlyphIcon className={cn(className, "session-workbuddy-process-icon")} />;
    case "terminal":
      return <Terminal className={className} strokeWidth={1.9} />;
    case "read":
    case "viewed":
      return <Eye className={className} strokeWidth={1.7} />;
    case "edit":
    case "write":
      return <Pencil className={className} strokeWidth={1.8} />;
    case "glob":
      return <Folder className={className} strokeWidth={1.9} />;
    case "search":
      return <Search className={className} strokeWidth={1.9} />;
    case "browser":
      return <Eye className={className} strokeWidth={1.7} />;
    case "web":
      return <Globe className={className} strokeWidth={1.8} />;
    case "image":
      return <ImageIcon className={className} strokeWidth={1.8} />;
    case "delete":
      return <Trash2 className={className} strokeWidth={1.8} />;
    case "completion":
      return <CheckCircle2 className={className} strokeWidth={1.8} />;
    case "plan":
      return <ClipboardCheck className={className} strokeWidth={1.8} />;
    case "agent":
      return <Bot className={className} strokeWidth={1.8} />;
    case "widget":
      return <PanelsTopLeft className={className} strokeWidth={1.8} />;
    case "database":
      return <Database className={className} strokeWidth={1.8} />;
    case "cloud":
      return <Cloud className={className} strokeWidth={1.8} />;
    case "debug":
      return <Bug className={className} strokeWidth={1.8} />;
    default:
      return <Box className={className} strokeWidth={1.9} />;
  }
}

export function toolStatusText(status?: string) {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized.includes("approval") || normalized.includes("pending")) return t("session.status_awaiting_approval");
  if (normalized.includes("running") || normalized.includes("progress")) return t("session.status_in_progress");
  if (normalized.includes("error") || normalized.includes("failed")) return t("session.status_failed");
  return null;
}
