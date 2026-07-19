/** @jsxImportSource react */
import type { ComponentType } from "react";
import { useState } from "react";
import { Puzzle, UserRound } from "lucide-react";

import { t } from "../../../../i18n";
import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { shellChrome } from "@/react-app/design-system/type-scale";

type StorePrimaryTab = "experts" | "skills";
type StorePrimaryTabItem = {
  id: StorePrimaryTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export function StorePage(props: {
  expertsSlot?: React.ReactNode;
  skillsSlot: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<StorePrimaryTab>(
    props.expertsSlot ? "experts" : "skills",
  );
  const tabs: StorePrimaryTabItem[] = props.expertsSlot
    ? [
        { id: "experts", label: t("store.experts_tab"), icon: UserRound },
        { id: "skills", label: t("store.skills_tab"), icon: Puzzle },
      ]
    : [{ id: "skills", label: t("store.skills_tab"), icon: Puzzle }];

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background">
      <div className={cn(shellChrome.pageHeaderSimple, "border-b-0")}>
        <SegmentedTabGroup density="bare">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavTabButton
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                active={activeTab === tab.id}
                size="tab"
                shape="tab"
                aria-current={activeTab === tab.id ? "page" : undefined}
              >
                <Icon aria-hidden />
                <span>{tab.label}</span>
              </NavTabButton>
            );
          })}
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
