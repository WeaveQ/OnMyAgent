/** @jsxImportSource react */
/**
 * Personal local-agent host page — thin assembly.
 * State: `use-personal-local-agent-page`; layout: `personal-local-agent-page-sections`
 * (P1-5 residual file-size split).
 */
import { PersonalLocalAgentPageLayout } from "./personal-local-agent-page-sections";
import {
  usePersonalLocalAgentPage,
  type PersonalLocalAgentPageProps,
} from "./use-personal-local-agent-page";

export type { PersonalLocalAgentPageProps };

export function PersonalLocalAgentPage(props: PersonalLocalAgentPageProps) {
  const m = usePersonalLocalAgentPage(props);
  return <PersonalLocalAgentPageLayout m={m} />;
}
