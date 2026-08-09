/** @jsxImportSource react */
/**
 * Expert session page — assembly (hook + layout).
 * Logic: use-expert-page; chrome: expert-page-layout (P1-5 residual).
 */
import { useExpertPage, type ExpertPageProps } from "./use-expert-page";
import { ExpertPageLayout } from "./expert-page-layout";

export type { ExpertPageProps };

export function ExpertPage(props: ExpertPageProps) {
  const m = useExpertPage(props);
  return <ExpertPageLayout m={m} />;
}
