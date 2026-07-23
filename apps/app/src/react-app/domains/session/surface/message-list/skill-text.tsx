/** @jsxImportSource react */
import { useEffect, useRef } from "react";

import { SkillGlyphIcon } from "../../../../design-system/skill-glyph-icon";
import { parseSkillReference } from "../skill-reference";
import { applyTextHighlights } from "../text-highlights";
import { messageStateClass } from "./styles";
import { resolveDisplayedPastedText } from "./pasted-text";

export function HighlightedPlainText(props: {
  text: string;
  className: string;
  highlightQuery?: string;
  /** Map of paste label -> full text for expandable chips */
  pastedTextMap?: Map<string, string>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const displayText = resolveDisplayedPastedText(
    props.text,
    props.pastedTextMap,
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    queueMicrotask(() => {
      if (!rootRef.current || rootRef.current !== root) return;
      applyTextHighlights(root, props.highlightQuery ?? "");
    });
  }, [displayText, props.highlightQuery]);

  return (
    <div ref={rootRef} className={props.className}>
      {displayText}
    </div>
  );
}

export function SkillReferenceText(props: { text: string; highlightQuery?: string }) {
  const skillReference = parseSkillReference(props.text);
  if (!skillReference) {
    return (
      <HighlightedPlainText
        text={props.text}
        className="whitespace-pre-wrap wrap-break-word text-dls-text"
        highlightQuery={props.highlightQuery}
      />
    );
  }

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-pre-wrap wrap-break-word text-dls-text">
      <span className={messageStateClass.skillReferenceChip}>
        <SkillGlyphIcon className="size-3 shrink-0" aria-hidden="true" />
        {skillReference.name}
      </span>
      {skillReference.arguments ? (
        <HighlightedPlainText
          text={skillReference.arguments}
          className="min-w-0 wrap-break-word"
          highlightQuery={props.highlightQuery}
        />
      ) : null}
    </div>
  );
}
