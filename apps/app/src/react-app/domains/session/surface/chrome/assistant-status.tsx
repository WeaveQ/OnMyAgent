/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PaperGrainGradient } from "@onmyagent/ui/react";

import { Button } from "@/components/ui/button";
import { t } from "../../../../../i18n";
import { sessionSurfaceTextClass } from "../surface-styles";

const LOADING_TIP_DELAY_MS = 4_000;
const LOADING_TIP_ROTATION_MS = 10_000;
const LOADING_TIPS_DISMISSED_KEY = "onmyagent.transcriptLoadingTips.dismissed.v1";

function loadingTipsDismissed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOADING_TIPS_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function AssistantWaitingCard({
  label = t("session.assistant_thinking"),
  collapseLayout = false,
  detail,
}: {
  label?: string;
  collapseLayout?: boolean;
  detail?: string;
}) {
  const tips = [
    t("session.loading_tip_workspace"),
    t("session.loading_tip_permissions"),
    t("session.loading_tip_context"),
    t("session.loading_tip_follow"),
    t("session.loading_tip_artifacts"),
  ];
  const [tipsVisible, setTipsVisible] = useState(false);
  const [tipsDismissed, setTipsDismissed] = useState(loadingTipsDismissed);
  const [tipsPaused, setTipsPaused] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    if (tipsDismissed) return;
    const timeout = window.setTimeout(() => setTipsVisible(true), LOADING_TIP_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [tipsDismissed]);

  useEffect(() => {
    if (!tipsVisible || tipsDismissed || tipsPaused || tips.length < 2) return;
    const interval = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % tips.length);
    }, LOADING_TIP_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [tips.length, tipsDismissed, tipsPaused, tipsVisible]);

  const dismissTips = () => {
    setTipsDismissed(true);
    setTipsVisible(false);
    try {
      window.localStorage.setItem(LOADING_TIPS_DISMISSED_KEY, "true");
    } catch {
      // Dismiss for the current component lifetime when storage is unavailable.
    }
  };

  const content = (
    <div
      className="flex justify-start"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setTipsPaused(true)}
      onMouseLeave={() => setTipsPaused(false)}
      onFocusCapture={() => setTipsPaused(true)}
      onBlurCapture={() => setTipsPaused(false)}
    >
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
        <span className="session-transcript-loading-shimmer">{label}</span>
        {detail ? <span className="text-dls-tertiary">{detail}</span> : null}
        {tipsVisible && !tipsDismissed ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-dls-tertiary">
            <span aria-hidden="true">·</span>
            <span className="max-w-96 truncate">{tips[tipIndex]}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-5 text-dls-tertiary hover:text-dls-text"
              title={t("session.loading_tip_dismiss")}
              aria-label={t("session.loading_tip_dismiss")}
              onClick={dismissTips}
            >
              <X size={12} />
            </Button>
          </span>
        ) : null}
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
