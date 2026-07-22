/** @jsxImportSource react */
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { currentLocale, t } from "../../../../../i18n";
import enLoadingTips from "../../../../../i18n/locales/en/session-loading-tips";
import zhLoadingTips from "../../../../../i18n/locales/zh/session-loading-tips";
import zhTWLoadingTips from "../../../../../i18n/locales/zh-TW/session-loading-tips";
import { sessionSurfaceTextClass } from "../surface-styles";

const LOADING_TIP_DELAY_MS = 4_000;
const LOADING_TIP_ROTATION_MS = 10_000;

export function nextLoadingTipIndex(current: number | null, count: number) {
  if (count < 1) return null;
  if (current === null) return Math.floor(Math.random() * count);
  if (count < 2) return 0;
  const offset = 1 + Math.floor(Math.random() * (count - 1));
  return (current + offset) % count;
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
  const locale = currentLocale();
  const tips = locale === "en"
    ? enLoadingTips
    : locale === "zh-TW"
      ? zhTWLoadingTips
      : zhLoadingTips;
  const [tipsVisible, setTipsVisible] = useState(false);
  const [tipsPaused, setTipsPaused] = useState(false);
  const [tipIndex, setTipIndex] = useState<number | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setTipIndex(nextLoadingTipIndex(null, tips.length));
      setTipsVisible(true);
    }, LOADING_TIP_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [tips.length]);

  useEffect(() => {
    if (!tipsVisible || tipsPaused || tips.length < 2) return;
    const interval = window.setInterval(() => {
      setTipIndex((current) => nextLoadingTipIndex(current, tips.length));
    }, LOADING_TIP_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [tips.length, tipsPaused, tipsVisible]);

  const content = (
    <div
      className="flex justify-start"
      role="status"
      aria-live="polite"
    >
      <div className="session-transcript-loading-line">
        <span className="session-transcript-loading-shimmer">{label}</span>
        {detail ? <span className="text-dls-text-tertiary">{detail}</span> : null}
        {tipsVisible && tipIndex !== null ? (
          <span
            className="session-transcript-loading-tip"
            onMouseEnter={() => setTipsPaused(true)}
            onMouseLeave={() => setTipsPaused(false)}
            onFocusCapture={() => setTipsPaused(true)}
            onBlurCapture={() => setTipsPaused(false)}
          >
            <span aria-hidden="true">·</span>
            <span
              key={tips[tipIndex]}
              className="max-w-96 truncate animate-in fade-in duration-200"
            >
              {tips[tipIndex]}
            </span>
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

export function OutputLimitContinueCard(props: {
  busy?: boolean;
  onContinue: () => void;
}) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <div className="my-2.5 flex max-w-xl flex-col gap-3" role="status">
      <div className="flex flex-col gap-2 rounded-md border border-dls-border bg-dls-surface-muted p-3">
        <div className="text-sm font-semibold text-dls-text">
          {t("session.output_limit_continue_title")}
        </div>
        <div className="text-sm text-dls-secondary">
          {t("session.output_limit_continue_content")}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.busy}
          onClick={() => setVisible(false)}
        >
          {t("session.output_limit_continue_cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={props.busy}
          onClick={() => {
            setVisible(false);
            props.onContinue();
          }}
        >
          {t("session.output_limit_continue_action")}
        </Button>
      </div>
    </div>
  );
}

export function TranscriptHistorySkeleton({ pairCount = 3 }: { pairCount?: number }) {
  return (
    <div
      className="mx-auto w-full max-w-[1120px] px-3 py-4"
      role="status"
      aria-label={t("session.loading_detail")}
    >
      {Array.from({ length: pairCount }, (_, index) => (
        <div key={index} className="pb-8">
          <div className="flex justify-end px-4 py-8">
            <Skeleton className="h-10 w-[min(58%,420px)] rounded-xl" />
          </div>
          <div className="px-3">
            <div className="mb-3 flex items-center gap-2.5">
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-24 rounded-lg" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-[88%] rounded-lg" />
              <Skeleton className="h-3.5 w-[72%] rounded-lg" />
              <Skeleton className="h-3.5 w-[46%] rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
