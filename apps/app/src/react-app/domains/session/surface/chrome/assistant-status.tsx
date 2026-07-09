/** @jsxImportSource react */
import { PaperGrainGradient } from "@onmyagent/ui/react";

import { t } from "../../../../../i18n";
import { sessionSurfaceTextClass } from "../surface-styles";

export function AssistantWaitingCard({
  label = t("session.assistant_thinking"),
  collapseLayout = false,
  detail,
}: {
  label?: string;
  collapseLayout?: boolean;
  detail?: string;
}) {
  const content = (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="inline-flex items-center gap-1.5 px-1 py-1 text-xs text-dls-secondary">
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            overflow: "hidden",
          }}
        >
          <PaperGrainGradient
            speed={12}
            softness={0.1}
            intensity={1}
            noise={0.05}
            shape="sphere"
            colors={["#818cf8", "#fb7185", "#fbbf24", "#34d399"]}
            colorBack="#ffffff00"
            style={{
              backgroundColor: "#818cf8",
              width: "100%",
              height: "100%",
              borderRadius: "50%",
            }}
          />
        </div>
        <span>{label}</span>
        {detail ? <span className="text-dls-tertiary">{detail}</span> : null}
      </div>
    </div>
  );

  if (collapseLayout) {
    return <div>{content}</div>;
  }

  return content;
}

export function AssistantNoVisibleOutputCard(props: { text: string }) {
  return (
    <div
      className={sessionSurfaceTextClass.noVisibleOutput}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-3xl">
        {props.text || t("session.assistant_empty_response")}
      </div>
    </div>
  );
}

export function AssistantStatusSpacer() {
  return (
    <div className="invisible" aria-hidden="true">
      <AssistantWaitingCard
        label={t("session.assistant_responding")}
        collapseLayout
      />
    </div>
  );
}

