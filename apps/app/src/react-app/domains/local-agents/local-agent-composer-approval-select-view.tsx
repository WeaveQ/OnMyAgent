/** @jsxImportSource react */
import { useId, useState } from "react";
import { ChevronDown, Shield, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PersonalLocalAgentApprovalMode } from "../../../app/lib/desktop";
import { APPROVAL_MODE_OPTIONS } from "./local-agent-page-model";

type LocalAgentComposerApprovalSelectProps = {
  value: PersonalLocalAgentApprovalMode;
  onChange: (value: PersonalLocalAgentApprovalMode) => void;
  disabled?: boolean;
};

function optionFor(value: PersonalLocalAgentApprovalMode) {
  return APPROVAL_MODE_OPTIONS.find((option) => option.id === value) ?? APPROVAL_MODE_OPTIONS[0];
}

export function LocalAgentComposerApprovalSelect(
  props: LocalAgentComposerApprovalSelectProps,
) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const selected = optionFor(props.value);
  const autoApprove = props.value === "auto";

  return (
    <div className="min-w-0 shrink" data-testid="local-agent-composer-approval">
      <DropdownMenu
        modal={false}
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) return;
          const selectedItem = document
            .getElementById(menuId)
            ?.querySelector('[role="menuitemradio"][aria-checked="true"]');
          if (selectedItem instanceof HTMLElement) selectedItem.focus();
        }}
      >
        <DropdownMenuTrigger
          disabled={props.disabled}
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 max-w-44 shrink min-w-0 gap-1.5 rounded-lg px-2 text-sm font-normal leading-none disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-3.5",
                autoApprove
                  ? "text-dls-danger hover:bg-dls-hover hover:text-dls-danger"
                  : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
              )}
              aria-label={t("local_agent.approval_aria")}
              title={selected.label}
            >
              {autoApprove ? (
                <ShieldAlert className="size-3.5 shrink-0 text-dls-danger" />
              ) : props.value === "read-only-auto" ? (
                <ShieldCheck className="size-3.5 shrink-0" />
              ) : (
                <Shield className="size-3.5 shrink-0" />
              )}
              <span
                className="min-w-0 truncate @max-[32rem]/local-composer:hidden"
                data-testid="local-agent-approval-label"
              >
                {selected.label}
              </span>
              <ChevronDown className="size-3.5 shrink-0 opacity-70" />
            </Button>
          }
        />
        <DropdownMenuContent
          id={menuId}
          align="start"
          side="top"
          sideOffset={12}
          className="w-72 min-w-0 max-w-[calc(100vw-2.5rem)] border border-dls-border"
        >
          <DropdownMenuRadioGroup
            value={props.value}
            onValueChange={(value) => {
              const option = APPROVAL_MODE_OPTIONS.find((candidate) => candidate.id === value);
              if (option) {
                props.onChange(option.id);
                setOpen(false);
              }
            }}
          >
            {APPROVAL_MODE_OPTIONS.map((option) => {
              const Icon =
                option.id === "auto"
                  ? ShieldAlert
                  : option.id === "read-only-auto"
                    ? ShieldCheck
                    : Shield;
              return (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  className="items-start gap-2.5 py-1.5"
                  title={option.description}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      option.id === "auto" ? "text-dls-danger" : "text-dls-secondary",
                    )}
                  />
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate text-sm font-medium leading-5 text-dls-text">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block truncate whitespace-nowrap text-xs leading-4 text-dls-secondary">
                      {option.description}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
