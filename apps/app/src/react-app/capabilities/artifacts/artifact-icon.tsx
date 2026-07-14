/** @jsxImportSource react */
import { File, FileCode, FileImage, FileSpreadsheet, FileText, FileType, Globe } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OpenTargetPreview } from "./open-target";

interface ArtifactIconProps {
  type: OpenTargetPreview;
  className?: string;
}

// DESIGN.md § 4h Session & Artifact Variants. Artifact icons are the
// canonical `artifact-hue.*` consumer; each preview type maps to its
// semantic hue token so light/dark inversion follows the design
// contract (see § 11 Intentional Exceptions — `artifact-hue.*` is
// scoped to ArtifactCard surfaces). `browser` has no artifact-hue
// slot (URLs are not artifacts), so it stays on the semantic accent.
export function ArtifactIcon({ type, className }: ArtifactIconProps) {
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
    return <FileType className={cn("size-3.5 shrink-0 text-dls-secondary", className)} />;
  }

  return <File className={cn("size-3.5 shrink-0 text-dls-secondary", className)} />;
}
