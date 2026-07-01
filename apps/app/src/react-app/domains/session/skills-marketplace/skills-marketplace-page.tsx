/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";

import {
  installBuiltinSkillPackage,
  listLocalSkills,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { SKILL_MARKETPLACE_CATEGORIES } from "./categories";
import { BUILTIN_MARKETPLACE_SKILLS } from "./data";
import type { SkillMarketplaceEntry } from "./types";

const OPC_AGGREGATED_CATEGORY_IDS = new Set([
  "developer",
  "deploy",
  "productivity",
  "office",
]);

function skillFallbackInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "S";
}

function SkillIcon(props: { skill: SkillMarketplaceEntry }) {
  if (props.skill.iconUrl) {
    return (
      <img
        src={props.skill.iconUrl}
        alt=""
        className="size-8 shrink-0 rounded-md object-cover ring-1 ring-dls-border"
      />
    );
  }
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface-muted text-sm font-semibold text-dls-secondary ring-1 ring-dls-border">
      {skillFallbackInitial(props.skill.displayName)}
    </span>
  );
}

function isOnmyagentSkillPath(path: string): boolean {
  return path.replaceAll("\\", "/").includes("/.onmyagent/skills/");
}

function SkillCard(props: {
  skill: SkillMarketplaceEntry;
  installed: boolean;
  installing: boolean;
  onInstall: (skill: SkillMarketplaceEntry) => void;
}) {
  return (
    <div className="flex min-h-24 items-center gap-3 rounded-md border border-dls-border bg-dls-surface px-4 py-3 transition-colors hover:border-dls-border-strong">
      <SkillIcon skill={props.skill} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold leading-5 text-dls-text">
          {props.skill.displayName}
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
          {props.skill.description}
        </div>
      </div>
      {props.installed ? (
        <span
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-dls-surface-muted text-dls-secondary"
          aria-label={t("skills_marketplace.installed")}
          title={t("skills_marketplace.installed")}
        >
          <Check className="size-3.5" />
        </span>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={props.installing}
                className="shrink-0 rounded-md bg-dls-surface-muted text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag"
                aria-label={t("skills_marketplace.install_skill", {
                  name: props.skill.displayName,
                })}
                onClick={() => props.onInstall(props.skill)}
              >
                {props.installing ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            }
          />
          <TooltipContent side="top">
            <span>{t("skills_marketplace.install")}</span>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function SkillsMarketplacePage(props: {
  workspaceRoot?: string | null;
  query?: string;
}) {
  const [categoryId, setCategoryId] = useState("all");
  const [installedSkillNames, setInstalledSkillNames] = useState<Set<string>>(
    () => new Set(),
  );
  const [installingSkillName, setInstallingSkillName] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktopRuntime() || !props.workspaceRoot) return undefined;
    let cancelled = false;
    listLocalSkills(props.workspaceRoot)
      .then((response) => {
        if (cancelled || !Array.isArray(response)) return;
        const names = new Set<string>();
        for (const entry of response) {
          if (
            entry &&
            typeof entry === "object" &&
            "name" in entry &&
            "path" in entry &&
            typeof entry.name === "string" &&
            typeof entry.path === "string" &&
            isOnmyagentSkillPath(entry.path)
          ) {
            names.add(entry.name);
          }
        }
        setInstalledSkillNames(names);
      })
      .catch((error) => {
        console.warn("[skills-marketplace] failed to list installed skills", error);
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspaceRoot]);

  const filteredSkills = useMemo(() => {
    const normalizedQuery = (props.query ?? "").trim().toLowerCase();
    return BUILTIN_MARKETPLACE_SKILLS.filter((skill) => {
      const categoryMatches =
        skill.categoryId === categoryId ||
        skill.categoryIds.includes(categoryId) ||
        (
          categoryId === "opc" &&
          (
            OPC_AGGREGATED_CATEGORY_IDS.has(skill.categoryId) ||
            skill.categoryIds.some((id) => OPC_AGGREGATED_CATEGORY_IDS.has(id))
          )
        );
      if (
        categoryId !== "all" &&
        !categoryMatches
      ) {
        return false;
      }
      if (!normalizedQuery) return true;
      const text = [
        skill.skillName,
        skill.displayName,
        skill.description,
        skill.categoryLabel,
        ...skill.categoryLabels,
        ...skill.tags,
      ].join(" ").toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [categoryId, props.query]);

  const handleInstallSkill = async (skill: SkillMarketplaceEntry) => {
    if (installingSkillName) return;
    setInstallingSkillName(skill.skillName);
    try {
      if (!isDesktopRuntime()) {
        throw new Error("Desktop runtime is required to install built-in skills");
      }
      await installBuiltinSkillPackage({
        source: "builtin",
        packageName: skill.packageName,
        skillName: skill.skillName,
      });
      setInstalledSkillNames((current) => {
        const next = new Set(current);
        next.add(skill.skillName);
        return next;
      });
    } catch (error) {
      console.warn("[skills-marketplace] failed to install skill", error);
    } finally {
      setInstallingSkillName(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-dls-background">
      <div className="flex shrink-0 gap-3 overflow-x-auto px-6 py-4">
        {SKILL_MARKETPLACE_CATEGORIES.map((category) => (
          <Button
            key={category.id}
            type="button"
            size="xs"
            variant={categoryId === category.id ? "default" : "ghost"}
            onClick={() => setCategoryId(category.id)}
            className="shrink-0 mac:titlebar-no-drag"
          >
            {t(category.labelKey)}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              installed={installedSkillNames.has(skill.skillName)}
              installing={installingSkillName === skill.skillName}
              onInstall={handleInstallSkill}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
