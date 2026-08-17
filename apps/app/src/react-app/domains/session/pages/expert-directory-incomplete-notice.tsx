/** @jsxImportSource react */
import { t } from "../../../../i18n";
import { NoticeBox } from "@/components/ui/notice-box";

export function ExpertDirectoryIncompleteNotice() {
  return (
    <div className="px-6 py-16">
      <NoticeBox className="mx-auto max-w-lg text-left" size="comfortable" tone="warning">
        <div className="font-medium">
          {t("session.expert_directory_incomplete_title")}
        </div>
        <p className="mt-2 leading-6">
          {t("session.expert_directory_incomplete_body")}
        </p>
      </NoticeBox>
    </div>
  );
}
