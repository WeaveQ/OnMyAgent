/**
 * File category chips for the Files rail (shared Mine / Tasks / Experts).
 */
import { t } from "../../../i18n";

export type FileCategory =
  | "all"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "website"
  | "markdown"
  | "code"
  | "other";

export const FILE_CATEGORIES: FileCategory[] = [
  "all",
  "document",
  "spreadsheet",
  "presentation",
  "pdf",
  "image",
  "video",
  "audio",
  "website",
  "markdown",
  "code",
  "other",
];

const FILE_CATEGORY_BY_EXT: Record<string, FileCategory> = {
  md: "markdown",
  markdown: "markdown",
  txt: "document",
  doc: "document",
  docx: "document",
  rtf: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  key: "presentation",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
  tiff: "image",
  tif: "image",
  avif: "image",
  mp4: "video",
  avi: "video",
  mov: "video",
  mkv: "video",
  wmv: "video",
  flv: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  ogg: "audio",
  m4a: "audio",
  wma: "audio",
  html: "website",
  css: "website",
  htm: "website",
  js: "code",
  ts: "code",
  jsx: "code",
  tsx: "code",
  py: "code",
  rs: "code",
  go: "code",
  java: "code",
  c: "code",
  cpp: "code",
  h: "code",
  hpp: "code",
  rb: "code",
  php: "code",
  swift: "code",
  kt: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  sql: "code",
  r: "code",
  json: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  xml: "code",
  ini: "code",
  env: "code",
  scss: "code",
  sass: "code",
  less: "code",
};

export function getFileCategory(name: string): FileCategory {
  const ext =
    name.lastIndexOf(".") > 0
      ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
      : "";
  return FILE_CATEGORY_BY_EXT[ext] || "other";
}

/** Localized chip/label for a file category (shared by Mine + Tasks/Experts). */
export function fileCategoryLabel(category: FileCategory): string {
  return t(fileCategoryI18nKey(category));
}

export function fileCategoryI18nKey(category: FileCategory): string {
  switch (category) {
    case "all":
      return "files.category_all";
    case "document":
      return "files.category_document";
    case "spreadsheet":
      return "files.category_spreadsheet";
    case "presentation":
      return "files.category_presentation";
    case "pdf":
      return "files.category_pdf";
    case "image":
      return "files.category_image";
    case "video":
      return "files.category_video";
    case "audio":
      return "files.category_audio";
    case "website":
      return "files.category_website";
    case "markdown":
      return "files.category_markdown";
    case "code":
      return "files.category_code";
    case "other":
      return "files.category_other";
  }
}
