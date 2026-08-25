/** @jsxImportSource react */
import { t } from "../../../i18n";
import { MarkdownPreview } from "../../capabilities/artifacts/preview";
import {
  headingTitleFromBody,
  parseKnowledgeNoteProps,
  splitMarkdownFrontmatter,
} from "./knowledge-vault-frontmatter";
import { GETTING_STARTED_REL_PATH } from "./knowledge-vault-model";
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
  const fileName = props.relPath.split("/").pop() || props.relPath;
  const heading = headingTitleFromBody(body);
  const title =
    propsValue.title.trim() ||
    heading ||
    (props.relPath === GETTING_STARTED_REL_PATH
      ? t("knowledge.getting_started")
      : fileName.replace(/\.md$/i, "")) ||
    props.relPath;
  const folderCrumbs = props.relPath.split("/").filter(Boolean).slice(0, -1);
  const crumbs = [props.vaultLabel, ...folderCrumbs];

  return (
    <div className="flex min-h-0 flex-1 flex-col" onDoubleClick={props.onEdit}>
      {crumbs.filter(Boolean).length > 1 ? (
        <div className="shrink-0 truncate px-6 py-2 text-center text-xs text-dls-secondary">
          {crumbs.filter(Boolean).join(" / ")}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <article className="mx-auto max-w-3xl px-8 pb-16 pt-6">
          {heading ? null : (
            <h1 className="mb-4 text-xl font-medium tracking-tight text-dls-text">{title}</h1>
          )}
          <KnowledgeVaultProperties value={propsValue} onChange={() => undefined} readOnly />
          <div className="mt-8">
            <MarkdownPreview className="h-auto overflow-visible p-0" content={body} />
          </div>
        </article>
      </div>
    </div>
  );
}
