/** @jsxImportSource react */
/**
 * Runtime-independent first frame for the assistant's draft home.
 *
 * The real composer requires a live server/client/token tuple. The home
 * identity does not, so keep it visible while that tuple is being resolved
 * instead of leaving the main column empty after the boot overlay fades.
 */
import { SessionSurfaceDraftHome } from "../surface/chrome/session-surface-draft-home";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { t } from "../../../../i18n";

export function AssistantStartupHome(props: {
  categoryId: AssistantCategoryId;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center px-6 pb-8 pt-20"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex w-full max-w-2xl flex-col items-center">
        <SessionSurfaceDraftHome
          categoryId={props.categoryId}
          title={t("session.assistant_work_title")}
          subtitle={t("session.assistant_work_subtitle")}
        />
        <div className="flex min-h-32 w-full flex-col rounded-xl border border-dls-border bg-dls-surface-solid px-5 py-4">
          <div className="flex-1 text-sm text-dls-secondary">
            {t("system.load_session_route")}
          </div>
          <div className="flex items-center gap-2 text-xs text-dls-secondary">
            <LoadingSpinner size="sm" />
            <span>{t("session.preparing_workspace")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
