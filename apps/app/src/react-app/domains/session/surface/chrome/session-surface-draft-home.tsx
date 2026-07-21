/** @jsxImportSource react */
/**
 * Assistant draft-home brand title above the composer.
 */
import { AssistantDraftHomeMark } from "./avatars";
import { sessionSurfaceTextClass } from "../surface-styles";
import type { AssistantCategoryId } from "../personal-assistant-config";

export function SessionSurfaceDraftHome(props: {
  categoryId: AssistantCategoryId;
  title: string;
  subtitle?: string;
}) {
  return (
    // Brand hero above composer; outer shell handles upper-centered placement.
    // Generous title→composer gap so the card sits clear of the hero.
    <div className="mb-8 flex w-full flex-col items-center text-center">
      <div className="flex items-center gap-3 text-dls-text">
        <AssistantDraftHomeMark categoryId={props.categoryId} />
        <h2 className={sessionSurfaceTextClass.draftHomeTitle}>{props.title}</h2>
      </div>
      {props.subtitle ? (
        <p className={sessionSurfaceTextClass.draftHomeSubtitle}>{props.subtitle}</p>
      ) : null}
    </div>
  );
}
