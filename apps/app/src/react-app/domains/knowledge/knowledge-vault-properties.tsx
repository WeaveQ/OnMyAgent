/** @jsxImportSource react */
import { Calendar, Link2, List, Tag } from "lucide-react";

import { t } from "../../../i18n";
import type { KnowledgeNoteProps } from "./knowledge-vault-frontmatter";

type KnowledgeVaultPropertiesProps = {
  value: KnowledgeNoteProps;
  onChange: (next: KnowledgeNoteProps) => void;
  readOnly?: boolean;
};

function PropertyRow(props: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] items-start gap-3 py-1">
      <div className="flex items-center gap-2 pt-0.5 text-sm text-dls-secondary">
        {props.icon}
        <span>{props.label}</span>
      </div>
      <div className="min-w-0 pt-0.5 text-sm text-dls-text">{props.children}</div>
    </div>
  );
}

function relatedItems(related: readonly string[]): string[] {
  const items: string[] = [];
  for (const raw of related) {
    const matches = raw.match(/\[\[[^\]]+\]\]/g);
    if (matches?.length) items.push(...matches);
    else if (raw.trim()) items.push(raw.trim());
  }
  return items;
}

export function KnowledgeVaultProperties(props: KnowledgeVaultPropertiesProps) {
  const links = relatedItems(props.value.related);
  const showTitle = Boolean(props.value.title.trim());
  const showCreated = Boolean(props.value.created.trim());
  const showUpdated = Boolean(props.value.updated.trim());
  const showTags = props.value.tags.length > 0;
  const showRelated = links.length > 0;
  const showSource = Boolean(props.value.source.trim());
  if (!showTitle && !showCreated && !showUpdated && !showTags && !showRelated && !showSource) {
    return null;
  }

  return (
    <div className="shrink-0 px-5 pb-3 pt-4">
      <div className="mb-2 text-sm font-semibold text-dls-text">{t("knowledge.props_title")}</div>
      {showTitle ? (
        <PropertyRow icon={<List className="size-3.5" />} label={t("knowledge.props_title_field")}>
          {props.value.title}
        </PropertyRow>
      ) : null}
      {showCreated ? (
        <PropertyRow icon={<Calendar className="size-3.5" />} label={t("knowledge.props_created")}>
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="size-3.5 text-dls-secondary" aria-hidden />
            {props.value.created}
          </span>
        </PropertyRow>
      ) : null}
      {showUpdated ? (
        <PropertyRow icon={<Calendar className="size-3.5" />} label={t("knowledge.props_updated")}>
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="size-3.5 text-dls-secondary" aria-hidden />
            {props.value.updated}
          </span>
        </PropertyRow>
      ) : null}
      {showTags ? (
        <PropertyRow icon={<Tag className="size-3.5" />} label={t("knowledge.props_tags")}>
          <div className="flex flex-wrap items-center gap-1.5">
            {props.value.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-dls-accent-soft px-2 py-0.5 text-xs text-dls-accent"
              >
                {tag}
              </span>
            ))}
          </div>
        </PropertyRow>
      ) : null}
      {showRelated ? (
        <PropertyRow icon={<Link2 className="size-3.5" />} label={t("knowledge.props_related")}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {links.map((link, index) => (
              <span key={`${link}-${index}`} className="text-sm text-dls-accent">
                {link}
                {index < links.length - 1 ? "," : ""}
              </span>
            ))}
          </div>
        </PropertyRow>
      ) : null}
      {showSource ? (
        <PropertyRow icon={<List className="size-3.5" />} label={t("knowledge.props_source")}>
          {props.value.source}
        </PropertyRow>
      ) : null}
    </div>
  );
}
