/** @jsxImportSource react */
import { Globe } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OpenTargetPreview } from "./open-target";

interface ArtifactIconProps {
  type?: OpenTargetPreview;
  className?: string;
  /** Optional basename/path — used to select the extension-specific glyph. */
  name?: string;
}

function extname(value: string) {
  const base = value.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? "";
  const index = base.lastIndexOf(".");
  return index >= 0 ? base.slice(index) : "";
}

type CodexFileIconKind = "html" | "json" | "markdown" | "python" | "svg" | "text" | "zip";

function codexFileIconKind(ext: string): CodexFileIconKind | null {
  if ([".py", ".pyi", ".pyw", ".pyx"].includes(ext)) return "python";
  if ([".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bz2", ".xz", ".jar", ".war"].includes(ext)) return "zip";
  if ([".txt", ".log", ".cfg", ".conf", ".ini", ".rst", ".rtf"].includes(ext)) return "text";
  if ([".json", ".json5", ".jsonc", ".jsonl"].includes(ext)) return "json";
  if ([".md", ".markdown", ".mdx"].includes(ext)) return "markdown";
  if ([".html", ".htm"].includes(ext)) return "html";
  if (ext === ".svg") return "svg";
  return null;
}

function CodexFileIcon(props: { kind: CodexFileIconKind; className?: string }) {
  const shared = cn("size-3.5 shrink-0", props.className);
  const colors: Record<CodexFileIconKind, string> = {
    html: "light-dark(#d47628, #ffa359)",
    json: "light-dark(#d47628, #ffa359)",
    markdown: "light-dark(#199f43, #5ecc71)",
    python: "light-dark(#1a85d4, #69b1ff)",
    svg: "light-dark(#d47628, #ffa359)",
    text: "light-dark(#84848a, #adadb1)",
    zip: "light-dark(#d47628, #ffa359)",
  };
  const commonProps = {
    "aria-hidden": true,
    className: shared,
    style: { color: colors[props.kind] },
    viewBox: "0 0 16 16",
  };

  if (props.kind === "python") {
    return (
      <svg {...commonProps} data-artifact-file-kind="codex-python">
        <path fill="currentColor" d="M8.33 8.4H10c1.16 0 1.9-.73 1.9-1.86V5.08q0-.24.25-.24h.74c.75 0 1.33.32 1.66.97q.4.73.41 1.46c.09.9.09 1.78-.24 2.67-.25.73-.75 1.3-1.58 1.46h-4.8c-.08 0-.25 0-.25.08v.4s.17.09.25.09h2.82q.34-.02.33.32v1.06c0 .56-.25.97-.75 1.13-.41.16-.83.33-1.24.4a7 7 0 0 1-2.98-.07 3 3 0 0 1-1.16-.49c-.33-.32-.58-.65-.5-1.14v-2.91c0-1.13.67-1.78 1.82-1.78q.89-.1 1.66-.08m2.32 4.86a.65.65 0 0 0-.66-.65c-.34 0-.67.33-.67.65s.33.57.67.65a.65.65 0 0 0 .66-.65" opacity=".8" />
        <path fill="currentColor" d="M7.67 7.6H6c-1.16 0-1.9.73-1.9 1.86v1.46q0 .24-.25.24h-.74c-.75 0-1.33-.32-1.66-.97a3 3 0 0 1-.41-1.46 6 6 0 0 1 .24-2.67c.25-.73.75-1.3 1.58-1.46h4.8c.08 0 .25 0 .25-.08v-.4s-.17-.09-.25-.09H4.85c-.24 0-.33-.08-.33-.32V2.65c0-.56.25-.97.75-1.13.41-.16.83-.33 1.24-.4a7 7 0 0 1 2.98.07c.41.09.83.25 1.16.49.33.32.58.65.5 1.13v2.92c0 1.14-.67 1.78-1.82 1.78-.58.08-1.16.08-1.66.08M5.35 2.73c0 .33.25.65.66.65.33 0 .66-.32.66-.65 0-.32-.33-.56-.66-.64a.65.65 0 0 0-.66.64" />
      </svg>
    );
  }

  if (props.kind === "markdown") {
    return (
      <svg {...commonProps} data-artifact-file-kind="codex-markdown">
        <path fill="currentColor" d="M1 12V4h2l2 2.5L7 4h2v8H7V7.5l-2 2-2-2V12zm9-3 3 3.5L16 9h-2V4h-2v5z" />
      </svg>
    );
  }

  if (props.kind === "json") {
    return (
      <svg {...commonProps} data-artifact-file-kind="codex-json">
        <path fill="currentColor" d="M13.25 11.5V9.75a.5.5 0 0 1 .36-.48l.55-.15a1.16 1.16 0 0 0 0-2.24l-.55-.15a.5.5 0 0 1-.36-.48V4.5a2.5 2.5 0 0 0-2.5-2.5h-.25a.5.5 0 0 0 0 1h.25a1.5 1.5 0 0 1 1.5 1.5v1.75a1.5 1.5 0 0 0 1.09 1.44l.54.15a.16.16 0 0 1 0 .32l-.54.15a1.5 1.5 0 0 0-1.09 1.44v1.75a1.5 1.5 0 0 1-1.5 1.5h-.25a.5.5 0 0 0 0 1h.25a2.5 2.5 0 0 0 2.5-2.5m-10.5 0V9.75a.5.5 0 0 0-.36-.48l-.55-.15a1.16 1.16 0 0 1 0-2.24l.55-.15a.5.5 0 0 0 .36-.48V4.5A2.5 2.5 0 0 1 5.25 2h.25a.5.5 0 0 1 0 1h-.25a1.5 1.5 0 0 0-1.5 1.5v1.75a1.5 1.5 0 0 1-1.09 1.44l-.54.15a.16.16 0 0 0 0 .32l.54.15a1.5 1.5 0 0 1 1.09 1.45v1.74a1.5 1.5 0 0 0 1.5 1.5h.25a.5.5 0 0 1 0 1h-.25a2.5 2.5 0 0 1-2.5-2.5" />
      </svg>
    );
  }

  if (props.kind === "html") {
    return (
      <svg {...commonProps} data-artifact-file-kind="codex-html">
        <path fill="currentColor" d="M8 1C2.24 1 1 2.24 1 8s1.24 7 7 7 7-1.24 7-7-1.24-7-7-7" opacity=".2" />
        <path fill="currentColor" d="M10.48 3.76a.5.5 0 0 1 .4.58L10.6 5.8h1.14a.5.5 0 0 1 0 1h-1.32L10 9.2h1.08a.5.5 0 0 1 0 1H9.8l-.3 1.64a.5.5 0 1 1-.98-.18l.27-1.46H6.4l-.3 1.64a.5.5 0 1 1-.98-.18l.27-1.46H4.25a.5.5 0 0 1 0-1h1.32L6 6.8H4.93a.5.5 0 0 1 0-1H6.2l.3-1.64a.5.5 0 1 1 .98.18L7.2 5.8h2.4l.3-1.64a.5.5 0 0 1 .58-.4M6.58 9.2h2.4l.44-2.4h-2.4z" />
      </svg>
    );
  }

  if (props.kind === "svg") {
    return (
      <svg {...commonProps} data-artifact-file-kind="codex-svg">
        <path fill="currentColor" d="M5 7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
        <path fill="currentColor" d="M6 1a5 5 0 0 1 4.58 3H7a3 3 0 0 0-3 3v3.58A5 5 0 0 1 6 1" opacity=".5" />
      </svg>
    );
  }

  if (props.kind === "zip") {
    return (
      <svg {...commonProps} data-artifact-file-kind="codex-zip">
        <path fill="currentColor" d="M4.585 2a2 2 0 0 1 1.028.285l1.788 1.072a1 1 0 0 0 .514.143H12A2 2 0 0 1 13.935 5H0V4a2 2 0 0 1 2-2z" opacity=".5" />
        <path fill="currentColor" fillRule="evenodd" d="M14 12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-1.25h1v-1H0V6h14zM9.9 8.25c-.883 0-1.9.5-1.9.5H7v1h1v1s1.017.5 1.9.5c.884 0 1.6-.672 1.6-1.5s-.716-1.5-1.6-1.5M2 9.75v1h1v-1zm2 0v1h1v-1zm2 0v1h1v-1zm-5-1v1h1v-1zm2 0v1h1v-1zm2 0v1h1v-1z" clipRule="evenodd" />
      </svg>
    );
  }

  return (
    <svg {...commonProps} data-artifact-file-kind="codex-text">
      <path fill="currentColor" fillRule="evenodd" d="M8 4a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1H8z" clipRule="evenodd" opacity=".4" />
      <path fill="currentColor" d="M8.5 11a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1zm2-2a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1zm-1-8a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z" />
    </svg>
  );
}

type FileIconKind =
  | "audio"
  | "default"
  | "html"
  | "image"
  | "markdown"
  | "pdf"
  | "presentation"
  | "spreadsheet"
  | "video"
  | "word";

const FILE_ICON_COLORS: Record<FileIconKind, { base: string; fold: string }> = {
  audio: { base: "#4AA5AD", fold: "#72E2E6" },
  default: { base: "#CACAD1", fold: "#7F7F82" },
  html: { base: "#5484D1", fold: "#A1D7FF" },
  image: { base: "#5484D1", fold: "#A1D7FF" },
  markdown: { base: "#4AA5AD", fold: "#72E2E6" },
  pdf: { base: "#DE6A76", fold: "#FFC2C2" },
  presentation: { base: "#EB9752", fold: "#FFE2AB" },
  spreadsheet: { base: "#49AB69", fold: "#8FF57A" },
  video: { base: "#49AB69", fold: "#8FF57A" },
  word: { base: "#5484D1", fold: "#A1D7FF" },
};

const WORD_EXTENSIONS = new Set([
  ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".rtf", ".odt", ".pages",
]);
const PRESENTATION_EXTENSIONS = new Set([
  ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm", ".pot", ".potx", ".potm", ".key", ".odp",
]);
const SPREADSHEET_EXTENSIONS = new Set([
  ".csv", ".tsv", ".xls", ".xlsx", ".xlsm", ".xlsb", ".xlt", ".xltx", ".xltm", ".ods", ".fods", ".numbers",
]);
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".tif", ".avif", ".heic",
]);
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".flv", ".wmv",
]);
const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".opus",
]);

function fileIconKind(type: OpenTargetPreview, ext: string): FileIconKind {
  if ([".pdf", ".ofd"].includes(ext)) return "pdf";
  if (WORD_EXTENSIONS.has(ext)) return "word";
  if (PRESENTATION_EXTENSIONS.has(ext)) return "presentation";
  if (SPREADSHEET_EXTENSIONS.has(ext)) return "spreadsheet";
  if ([".md", ".markdown", ".mdx"].includes(ext)) return "markdown";
  if ([".html", ".htm"].includes(ext)) return "html";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";

  if (type === "pdf") return "pdf";
  if (type === "document") return "word";
  if (type === "presentation") return "presentation";
  if (type === "sheet") return "spreadsheet";
  if (type === "markdown") return "markdown";
  if (type === "html") return "html";
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  return "default";
}

function FileTypeGlyph({ kind }: { kind: FileIconKind }) {
  if (kind === "word") {
    return <path d="M4.7 10h6.1M4.7 12.1h4.2" stroke="white" strokeWidth="1.15" strokeLinecap="round" />;
  }
  if (kind === "spreadsheet") {
    return <path d="M4.3 8.4h7.4v4.2H4.3m3.7-4.2v4.2m-3.7-2.1h7.4" stroke="white" strokeWidth=".9" />;
  }
  if (kind === "presentation") {
    return <path d="M4.4 8.1h7.2v4.7H4.4z" fill="none" stroke="white" strokeWidth="1.05" />;
  }
  if (kind === "pdf") {
    return <path d="M4.5 12.5c2.3-.7 3.7-2.6 4.1-5.1.5 2.1 1.5 3.8 3.1 4.9-2.2-.5-4.6-.4-7.2.2Z" fill="none" stroke="white" strokeWidth=".8" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (kind === "markdown") {
    return <path d="M4.3 12.8V8.1c0-.6.8-.8 1.1-.3L8 11.6l2.6-3.8c.3-.5 1.1-.3 1.1.3v4.7" fill="none" stroke="white" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (kind === "html") {
    return <path d="m6.8 8.1-2.2 2.2 2.2 2.2m2.4-4.4 2.2 2.2-2.2 2.2" fill="none" stroke="white" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (kind === "image") {
    return <><circle cx="10.5" cy="8.2" r="1" fill="white" /><path d="m4.4 12.8 2.4-3 1.7 2 1.2-1.2 1.9 2.2Z" fill="white" /></>;
  }
  if (kind === "video") {
    return <path d="m7 8.2 4 2.2-4 2.3Z" fill="white" />;
  }
  if (kind === "audio") {
    return <path d="M10.7 7.4v4.1a1.5 1.5 0 1 1-1-1.4V8.3l-3.1.9v3a1.5 1.5 0 1 1-1-1.4V8.5Z" fill="white" />;
  }
  return null;
}

function FileTypeIcon(props: { kind: FileIconKind; className?: string }) {
  const colors = FILE_ICON_COLORS[props.kind];
  const family = ["word", "spreadsheet", "presentation", "pdf"].includes(props.kind)
    ? props.kind
    : undefined;
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      data-artifact-file-kind={props.kind}
      data-artifact-file-family={family}
      className={cn("size-3.5 shrink-0", props.className)}
    >
      <path
        d="M3.3 1h5.4c.8 0 1.2 0 1.6.2.3.1.6.4 1.1.9l1.6 1.7c.4.5.7.8.8 1.1.2.4.2.8.2 1.6v5.7c0 1.7-.8 2.5-2.5 2.5H4.2c-1.7 0-2.5-.8-2.5-2.5V3.5C1.7 1.8 2.5 1 3.3 1Z"
        fill={colors.base}
      />
      <path
        d="M8.5 1h.2c.8 0 1.2 0 1.6.2.3.1.6.4 1.1.9L13 3.8c.4.5.7.8.8 1.1v.2c-.2-.1-.4-.1-.8-.1h-.4c-1.4 0-2.1 0-2.6-.4-.4-.5-.4-1.2-.4-2.6v-.4c0-.3 0-.5-.1-.6Z"
        fill={colors.fold}
        opacity=".5"
      />
      <FileTypeGlyph kind={props.kind} />
    </svg>
  );
}

/** Shared WorkBuddy-style file icon for every artifact and workspace file list. */
export function ArtifactIcon({ type, className, name }: ArtifactIconProps) {
  if (type === "browser") {
    return <Globe className={cn("size-3.5 shrink-0 text-dls-accent", className)} />;
  }
  const ext = name ? extname(name) : "";
  const codexKind = codexFileIconKind(ext);
  if (codexKind) return <CodexFileIcon kind={codexKind} className={className} />;
  return <FileTypeIcon kind={fileIconKind(type ?? "external", ext)} className={className} />;
}
