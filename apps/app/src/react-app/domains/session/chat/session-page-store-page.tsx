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
        ["experts", t("store.experts_marketplace")],
        ["skills", t("store.skills_marketplace")],
      ]
    : [
        ["skills", t("store.skills_marketplace")],
      ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background">
      <div className="flex h-14 shrink-0 items-center border-b border-dls-border bg-dls-surface/80 px-6">
        <SegmentedTabGroup>
          {tabs.map(([tab, label]) => (
            <NavTabButton
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              active={activeTab === tab}
              size="tab"
              shape="tab"
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
