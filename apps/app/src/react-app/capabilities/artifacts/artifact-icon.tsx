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

type OfficeFileFamily = "word" | "spreadsheet" | "presentation" | "pdf";

const OFFICE_FILE_COLORS: Record<OfficeFileFamily, string> = {
  word: "#4F78DE",
  spreadsheet: "#35B56A",
  presentation: "#ED8A43",
  pdf: "#E85D72",
};

function OfficeFileIcon(props: {
  family: OfficeFileFamily;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      data-artifact-file-family={props.family}
      className={cn("size-3.5 shrink-0", props.className)}
    >
      <path
        d="M3.25 1.25h6.6l2.9 2.9v9.1c0 .83-.67 1.5-1.5 1.5h-8c-.83 0-1.5-.67-1.5-1.5V2.75c0-.83.67-1.5 1.5-1.5Z"
        fill={OFFICE_FILE_COLORS[props.family]}
      />
      <path d="M9.85 1.25v2.1c0 .55.45 1 1 1h1.9" fill="white" fillOpacity="0.42" />
      {props.family === "word" ? (
        <path d="M4.45 7h5.75M4.45 9h5.75M4.45 11h4.1" stroke="white" strokeWidth="1" strokeLinecap="round" />
      ) : props.family === "spreadsheet" ? (
        <path d="M4.25 6.5h6.2v5h-6.2v-5Zm2.05 0v5m2.1-5v5m-4.15-2.5h6.2" stroke="white" strokeWidth=".75" />
      ) : props.family === "presentation" ? (
        <path d="M4.25 6.5h6.2v4.35h-6.2V6.5Zm3.1 4.35v1.25m-1.55 0h3.1" stroke="white" strokeWidth=".85" strokeLinecap="round" />
      ) : (
        <path d="M4.2 10.9c1.05-.25 2.1-1.45 2.65-3.75.45 1.5 1.25 2.7 2.95 3.6-1.8-.35-3.55-.25-5.6.15Z" stroke="white" strokeWidth=".75" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/** Finer icons when preview class alone is too coarse (Office, media, archives). */
function iconForExtension(ext: string, className?: string) {
  if ([".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".rtf", ".odt", ".pages"].includes(ext)) {
    return <OfficeFileIcon family="word" className={className} />;
  }
  if ([".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm", ".pot", ".potx", ".potm", ".key", ".odp"].includes(ext)) {
    return <OfficeFileIcon family="presentation" className={className} />;
  }
  if ([".xls", ".xlsx", ".xlsm", ".xlsb", ".xlt", ".xltx", ".xltm", ".ods", ".fods", ".numbers"].includes(ext)) {
    return <OfficeFileIcon family="spreadsheet" className={className} />;
  }
  if ([".pdf", ".ofd"].includes(ext)) {
    return <OfficeFileIcon family="pdf" className={className} />;
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

  const officeIcon = iconForExtension(ext, className);

  if (officeIcon) return officeIcon;

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
    return <OfficeFileIcon family="pdf" className={className} />;
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
