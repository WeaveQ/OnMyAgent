/** @jsxImportSource react */
import { MarkdownPreview } from "../../capabilities/artifacts/preview";
import {
  headingTitleFromBody,
  parseKnowledgeNoteProps,
  splitMarkdownFrontmatter,
} from "./knowledge-vault-frontmatter";
import { KnowledgeVaultProperties } from "./knowledge-vault-properties";

type KnowledgeVaultReaderProps = {
  markdown: string;
  relPath: string;
  vaultLabel: string;
  onEdit: () => void;
};

export function KnowledgeVaultReader(props: KnowledgeVaultReaderProps) {
  const propsValue = parseKnowledgeNoteProps(props.markdown);
  const body = splitMarkdownFrontmatter(props.markdown).body;
  const title =
    propsValue.title.trim() ||
    headingTitleFromBody(body) ||
    props.relPath.split("/").pop() ||
    props.relPath;
  const crumbs = [
    props.vaultLabel,
    ...props.relPath.split("/").filter(Boolean).slice(0, -1),
    title,
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" onDoubleClick={props.onEdit}>
      <div className="shrink-0 truncate px-6 py-2 text-center text-xs text-dls-secondary">
        {crumbs.filter(Boolean).join(" / ")}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <article className="mx-auto max-w-3xl px-8 pb-16 pt-4">
          <h1 className="mb-6 text-3xl font-semibold tracking-tight text-dls-text">{title}</h1>
          <KnowledgeVaultProperties value={propsValue} onChange={() => undefined} readOnly />
          <div className="mt-8">
            <MarkdownPreview className="h-auto overflow-visible p-0" content={body} />
          </div>
        </article>
      </div>
    </div>
  );
}
