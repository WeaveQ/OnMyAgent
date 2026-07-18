import { useState } from "react";

import { Button } from "@/components/ui/button";
import { NavTabButton } from "@/components/ui/action-row";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

import { t } from "../../../../i18n";

import {
  BILLING_CHART_BARS,
  BILLING_USAGE_RECORDS,
  type BillingTab,
} from "./session-page-billing-model";
import { SessionPreviewPanel } from "./session-page-preview-panel";

const billingTextClass = {
  panelTitle: "text-base font-medium text-dls-text",
  subSectionTitle: "text-sm font-medium leading-5 text-dls-text",
};

export function BillingPage() {
  const [activeTab, setActiveTab] = useState<BillingTab>("usage");

  return (
    <div className="h-full overflow-auto bg-dls-surface px-6 py-6 text-dls-text">
      <div className="mx-auto max-w-7xl space-y-5">
        <SessionPreviewPanel as="section" className="flex min-h-16 items-center justify-between px-4" size="none">
          <h2 className={billingTextClass.panelTitle}>{t("session.billing_free_plan")}</h2>
          <Button
            type="button"
            size="sm"
          >
            {t("session.billing_upgrade")}
          </Button>
        </SessionPreviewPanel>

        <div className="flex gap-5 border-b border-dls-border">
          <BillingTabButton
            active={activeTab === "usage"}
            onClick={() => setActiveTab("usage")}
          >
            {t("session.billing_tab_usage")}
          </BillingTabButton>
          <BillingTabButton
            active={activeTab === "bill"}
            onClick={() => setActiveTab("bill")}
          >
            {t("session.billing_tab_bill")}
          </BillingTabButton>
        </div>

        {activeTab === "usage" ? <BillingUsagePanel /> : <BillingBillPanel />}
      </div>
    </div>
  );
}

function BillingTabButton(props: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <NavTabButton
      type="button"
      onClick={props.onClick}
      active={props.active}
      size="underline"
      shape="underline"
    >
      {props.children}
    </NavTabButton>
  );
}

function BillingUsagePanel() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <SessionPreviewPanel as="section">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <span className="text-2xl font-medium leading-none">1</span>
              <span className="ml-1 text-sm font-medium">/ 20</span>
              <span className="ml-2 text-xs text-dls-secondary">
                {t("session.billing_used_percent", { percent: 5 })}
              </span>
            </div>
            <span className="text-xs text-dls-secondary">
              {t("session.billing_period_placeholder")}
            </span>
          </div>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-dls-surface-muted">
            <div className="h-full w-[5%] rounded-full bg-dls-accent" />
          </div>
          <div className="space-y-2 text-sm">
            <BillingMetric
              color="bg-dls-accent"
              label={t("session.billing_daily_credits")}
              value="1 / 20"
            />
            <BillingMetric color="bg-dls-signal" label={t("session.billing_promo_credits")} value="0" />
            <BillingMetric color="bg-dls-status-warning" label={t("session.billing_addon_credits")} value="0" />
          </div>
        </SessionPreviewPanel>

        <SessionPreviewPanel as="section">
          <h3 className={`mb-4 ${billingTextClass.subSectionTitle}`}>{t("session.billing_last_14_days")}</h3>
          <div className="flex h-[116px] items-end gap-6 px-2">
            {BILLING_CHART_BARS.map((height, index) => (
              <div
                key={index}
                className="flex flex-1 flex-col items-center justify-end gap-2"
              >
                <div
                  className="w-full max-w-8 rounded-t-sm bg-dls-accent"
                  style={{ height: `${height}px` }}
                />
                <span className="text-xs text-dls-secondary">
                  {String(21 + index > 31 ? index - 10 : 21 + index).padStart(
                    2,
                    "0",
                  )}
                </span>
              </div>
            ))}
          </div>
        </SessionPreviewPanel>
      </div>

      <SessionPreviewPanel as="section">
        <h3 className={`mb-3 ${billingTextClass.subSectionTitle}`}>{t("session.billing_usage_records", { count: 20 })}</h3>
        <div className="overflow-hidden border-t border-dls-border">
          <div className="grid grid-cols-[1.25fr_0.75fr_1.1fr_0.55fr_0.5fr] border-b border-dls-border py-3 text-sm font-medium">
            <div>{t("session.billing_col_time")}</div>
            <div>{t("session.billing_col_scene")}</div>
            <div>{t("session.billing_col_session")}</div>
            <div>{t("session.billing_col_credits")}</div>
            <div />
          </div>
          {BILLING_USAGE_RECORDS.map((record) => (
            <div
              key={`${record.time}-${record.session}`}
              className="grid grid-cols-[1.25fr_0.75fr_1.1fr_0.55fr_0.5fr] border-b border-dls-mist py-4 text-sm last:border-b-0"
            >
              <div className="text-dls-secondary">{record.time}</div>
              <div className="text-dls-secondary">{record.scene}</div>
              <div>{record.session}</div>
              <div className="font-medium">{record.credits}</div>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="justify-start p-0 text-left text-dls-secondary hover:text-dls-text"
              >
                {t("session.billing_view_details")}
              </Button>
            </div>
          ))}
        </div>
      </SessionPreviewPanel>
    </div>
  );
}

function BillingMetric(props: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <StatusDot size="xs" tone="current" className={props.color} />
      <span className="flex-1">{props.label}</span>
      <span className="font-medium">{props.value}</span>
    </div>
  );
}

function BillingBillPanel() {
  return (
    <SessionPreviewPanel as="section" className="flex h-[220px] items-center justify-center text-sm text-dls-secondary">
      {t("session.billing_no_records")}
    </SessionPreviewPanel>
  );
}
