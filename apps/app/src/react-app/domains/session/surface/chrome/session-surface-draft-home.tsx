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
    // Brand hero above composer; body padding handles vertical placement.
    // Comfortable title→composer gap under the taller hero input card.
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
