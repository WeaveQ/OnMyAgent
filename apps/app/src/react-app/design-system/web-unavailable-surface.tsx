/** @jsxImportSource react */
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { NoticeBox } from "@/components/ui/notice-box";
import { APP_NAME, APP_NAME_LOWER } from "../../i18n/locales/brand";

export type WebUnavailableSurfaceProps = {
  unavailable: boolean;
  children: ReactNode;
  compact?: boolean;
  className?: string;
  contentClassName?: string;
};

const MESSAGE = `This feature is currently unavailable in ${APP_NAME} Web, check ${APP_NAME} Desktop for full functionality.`;

export function WebUnavailableSurface(props: WebUnavailableSurfaceProps) {
  const innerProps = props.unavailable
    ? {
        inert: true,
        "aria-disabled": true as const,
        className: "opacity-55",
      }
    : {
        className: "",
      };

  return (
    <div className={props.className}>
      {props.unavailable ? (
        <NoticeBox className={props.compact ? "mb-3" : "mb-4 rounded-2xl"} size={props.compact ? "default" : "comfortable"} tone="warning">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{MESSAGE}</span>
            <a
              href="https://onmyagentlabs.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline"
            >
              <span>Download {APP_NAME} Desktop</span>
              <ArrowUpRight size={props.compact ? 12 : 14} />
            </a>
          </div>
        </NoticeBox>
      ) : null}

      <div className={`relative ${props.contentClassName ?? ""}`}>
        <div {...innerProps}>{props.children}</div>
        {props.unavailable ? (
          <div
            className="absolute inset-0 z-10 cursor-not-allowed"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}
