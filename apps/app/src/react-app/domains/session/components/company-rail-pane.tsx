/** @jsxImportSource react */
import { CompanyStorePage } from "@/react-app/domains/plugins";
import { openCompanySettingsPath } from "../navigation/open-company-settings";

export function CompanyRailPane(props: {
  onChatWithSkill?: (skill: {
    name: string;
    path?: string;
    description?: string;
    displayNameZh?: string;
  }) => void;
}) {
  return (
    <CompanyStorePage
      onChatWithSkill={props.onChatWithSkill}
      onOpenCompanySettings={openCompanySettingsPath}
    />
  );
}
