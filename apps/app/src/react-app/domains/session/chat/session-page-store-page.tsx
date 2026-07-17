/** @jsxImportSource react */
import { useState } from "react";

import { t } from "../../../../i18n";
import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";

type StorePrimaryTab = "experts" | "skills";
type StorePrimaryTabItem = readonly [StorePrimaryTab, string];

export function StorePage(props: {
  expertsSlot?: React.ReactNode;
  skillsSlot: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<StorePrimaryTab>(
    props.expertsSlot ? "experts" : "skills",
  );
  const tabs: StorePrimaryTabItem[] = props.expertsSlot
    ? [
        ["experts", t("store.experts_tab")],
        ["skills", t("store.skills_tab")],
      ]
    : [
        ["skills", t("store.skills_tab")],
      ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background">
      <div className="flex h-12 shrink-0 items-center border-b border-dls-border bg-dls-background px-6">
        <SegmentedTabGroup className="h-8 w-fit shrink-0 gap-0.5 rounded-full p-0.5">
          {tabs.map(([tab, label]) => (
            <NavTabButton
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              active={activeTab === tab}
              size="default"
              shape="pill"
              className={
                activeTab === tab
                  ? "h-7 w-auto shrink-0 px-3 text-xs font-medium bg-dls-surface text-dls-text shadow-sm"
                  : "h-7 w-auto shrink-0 px-3 text-xs font-medium text-dls-secondary hover:bg-dls-hover/70 hover:text-dls-text"
              }
            >
              {label}
            </NavTabButton>
          ))}
        </SegmentedTabGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "experts" && props.expertsSlot
          ? props.expertsSlot
          : props.skillsSlot}
      </div>
    </div>
  );
}
