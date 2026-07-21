/** @jsxImportSource react */
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Globe,
  Presentation,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { OpenTargetPreview } from "./open-target";

interface ArtifactIconProps {
  type: OpenTargetPreview;
  className?: string;
  /** Optional basename/path — used to pick a more specific icon for `external` / `text`. */
  name?: string;
}

function extname(value: string) {
  const base = value.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? "";
  const index = base.lastIndexOf(".");
  return index >= 0 ? base.slice(index) : "";
}

/** Finer icons when preview class alone is too coarse (Office, media, archives). */
function iconForExtension(ext: string, className?: string) {
  if ([".doc", ".docx", ".rtf", ".odt", ".pages"].includes(ext)) {
    return <FileText className={cn("size-3.5 shrink-0 text-dls-artifact-hue-document", className)} />;
  }
  if ([".ppt", ".pptx", ".key", ".odp"].includes(ext)) {
    return <Presentation className={cn("size-3.5 shrink-0 text-dls-artifact-hue-document", className)} />;
  }
  if ([".xls", ".xlsx", ".ods", ".numbers"].includes(ext)) {
    return <FileSpreadsheet className={cn("size-3.5 shrink-0 text-dls-artifact-hue-data", className)} />;
  }
  if ([".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bz2"].includes(ext)) {
    return <FileArchive className={cn("size-3.5 shrink-0 text-dls-secondary", className)} />;
  }
  if ([".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"].includes(ext)) {
    return <FileAudio className={cn("size-3.5 shrink-0 text-dls-secondary", className)} />;
  }
  if ([".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv"].includes(ext)) {
    return <FileVideo className={cn("size-3.5 shrink-0 text-dls-secondary", className)} />;
  }
  if ([".json", ".jsonc"].includes(ext)) {
    return <FileJson className={cn("size-3.5 shrink-0 text-dls-artifact-hue-code", className)} />;
  }
  if (
    [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".rs",
      ".go",
      ".java",
      ".kt",
      ".swift",
      ".rb",
      ".php",
      ".c",
      ".h",
      ".cpp",
      ".hpp",
      ".cs",
      ".vue",
      ".svelte",
      ".css",
      ".scss",
      ".less",
      ".sh",
      ".bash",
      ".zsh",
      ".sql",
    ].includes(ext)
  ) {
    return <FileCode className={cn("size-3.5 shrink-0 text-dls-artifact-hue-code", className)} />;
  }
  return null;
}

// DESIGN.md § 4h Session & Artifact Variants. Artifact icons are the
// canonical `artifact-hue.*` consumer; each preview type maps to its
// semantic hue token so light/dark inversion follows the design
// contract (see § 11 Intentional Exceptions — `artifact-hue.*` is
// scoped to ArtifactCard surfaces). `browser` has no artifact-hue
// slot (URLs are not artifacts), so it stays on the semantic accent.
export function ArtifactIcon({ type, className, name }: ArtifactIconProps) {
  const ext = name ? extname(name) : "";

  if (type === "browser") {
    return <Globe className={cn("size-3.5 shrink-0 text-dls-accent", className)} />;
  }

  if (type === "markdown") {
    return <FileText className={cn("size-3.5 shrink-0 text-dls-artifact-hue-document", className)} />;
  }

  if (type === "sheet") {
    return <FileSpreadsheet className={cn("size-3.5 shrink-0 text-dls-artifact-hue-data", className)} />;
  }

  if (type === "image") {
    return <FileImage className={cn("size-3.5 shrink-0 text-dls-artifact-hue-image", className)} />;
  }

  if (type === "pdf") {
    return <FileText className={cn("size-3.5 shrink-0 text-dls-artifact-hue-document", className)} />;
  }

  if (type === "html") {
    return <FileCode className={cn("size-3.5 shrink-0 text-dls-artifact-hue-code", className)} />;
  }

  if (type === "text") {
    return (
      iconForExtension(ext, className) ?? (
        <FileType className={cn("size-3.5 shrink-0 text-dls-secondary", className)} />
      )
    );
  }

  // external / fallback — prefer extension-specific glyph (Office, media, …)
  return (
    iconForExtension(ext, className) ?? (
      <File className={cn("size-3.5 shrink-0 text-dls-secondary", className)} />
    )
  );
}
