/** @jsxImportSource react */
import { lazy, Suspense } from "react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { t } from "../../../i18n";

const ArtifactTextEditor = lazy(() =>
  import("../../capabilities/artifacts/artifact-text-editor").then((module) => ({
    default: module.ArtifactTextEditor,
  })),
);

type KnowledgeVaultEditorProps = {
  value: string;
  language: "markdown" | "text";
  onChange: (value: string) => void;
};

export function KnowledgeVaultEditor(props: KnowledgeVaultEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner />
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col" aria-label={t("knowledge.editor_label")}>
        <ArtifactTextEditor
          className="min-h-0 flex-1"
          value={props.value}
          language={props.language}
          onChange={props.onChange}
        />
      </div>
    </Suspense>
  );
}
