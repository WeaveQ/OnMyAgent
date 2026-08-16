/** @jsxImportSource react */
import { Columns2, FileCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { MarkdownPreview } from "../../capabilities/artifacts/preview";
import { t } from "../../../i18n";
import { KnowledgeVaultEditor } from "./knowledge-vault-editor";
import { knowledgePreviewBody } from "./knowledge-vault-preview-model";

type KnowledgeVaultSplitEditorProps = {
  value: string;
  language: "markdown" | "text";
  onChange: (value: string) => void;
  layout: "source" | "split";
  onLayoutChange: (layout: "source" | "split") => void;
};

export function KnowledgeVaultSplitEditor(props: KnowledgeVaultSplitEditorProps) {
  const preview = knowledgePreviewBody(props.value);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-end gap-0.5 border-b border-dls-border px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className={props.layout === "source" ? "bg-dls-list-selected" : undefined}
          onClick={() => props.onLayoutChange("source")}
          aria-label={t("knowledge.layout_source")}
          title={t("knowledge.layout_source")}
        >
          <FileCode className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className={props.layout === "split" ? "bg-dls-list-selected" : undefined}
          onClick={() => props.onLayoutChange("split")}
          aria-label={t("knowledge.layout_split")}
          title={t("knowledge.layout_split")}
        >
          <Columns2 className="size-3.5" />
        </Button>
      </div>
      {props.layout === "split" ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="50%" minSize="220px" className="min-w-0">
            <KnowledgeVaultEditor
              value={props.value}
              language={props.language}
              onChange={props.onChange}
            />
          </ResizablePanel>
          <ResizablePanel minSize="200px" className="min-w-0">
            <div className="h-full overflow-auto border-l border-dls-border bg-dls-background px-5 py-4">
              <MarkdownPreview className="h-auto overflow-visible p-0" content={preview} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <KnowledgeVaultEditor
          value={props.value}
          language={props.language}
          onChange={props.onChange}
        />
      )}
    </div>
  );
}
