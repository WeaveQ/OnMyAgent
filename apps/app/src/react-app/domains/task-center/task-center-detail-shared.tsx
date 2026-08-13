/** @jsxImportSource react */
import type { ReactNode } from "react";
import type { FileText } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { t } from "@/i18n";

export function formatTaskCenterTimestamp(value: number | null): string {
  return value ? new Date(value).toLocaleString() : t("task_center.not_available");
}

export function TaskCenterEmpty(props: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  const Icon = props.icon;
  return (
    <Empty variant="ghost" className="min-h-64">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function TaskCenterDetailLabel(props: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-dls-secondary">{props.label}</div>
      <div className="mt-1 min-w-0 text-sm leading-6 text-dls-text">
        {props.children}
      </div>
    </div>
  );
}
