/** @jsxImportSource react */
import type { ComponentType, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import {
  sectionBodyClass,
  sectionTitleClass,
} from "./modal-styles";

export type WorkspaceOptionCardProps = {
  title: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  endAdornment?: ReactNode;
};

export function WorkspaceOptionCard({
  title,
  description,
  icon: Icon,
  onClick,
  disabled,
  endAdornment,
}: WorkspaceOptionCardProps) {
  return (
    <ActionRowButton
      density="spacious"
      type="button"
      onClick={() => onClick?.()}
      disabled={disabled}
      className="group items-center gap-4"
    >
      <IconTile size="md" shape="xl" border>
        <Icon size={18} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className={sectionTitleClass}>{title}</div>
        <div className={sectionBodyClass}>{description}</div>
      </div>
      {endAdornment ?? (
        <ChevronRight
          size={16}
          className="shrink-0 text-dls-secondary transition-transform group-hover:translate-x-0.5"
        />
      )}
    </ActionRowButton>
  );
}
