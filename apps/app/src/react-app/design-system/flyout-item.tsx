/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Check, FileText, Folder } from "lucide-react";

export type FlyoutItemProps = {
  item: {
    id: string;
    rect: { top: number; left: number; width: number; height: number };
    targetRect: { top: number; left: number; width: number; height: number };
    label: string;
    icon: "file" | "check" | "folder";
  };
};

const flyoutItemClass = {
  shell: "pointer-events-none fixed z-[100] flex items-center gap-2 rounded-xl border border-dls-border bg-dls-decision px-3 py-2 text-white transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]",
  label: "max-w-[120px] truncate text-xs font-medium",
};

export function FlyoutItem(props: FlyoutItemProps) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const frame1 = requestAnimationFrame(() => {
      const frame2 = requestAnimationFrame(() => setActive(true));
      return () => cancelAnimationFrame(frame2);
    });
    return () => cancelAnimationFrame(frame1);
  }, []);

  return (
    <div
      className={flyoutItemClass.shell}
      style={{
        top: `${props.item.rect.top}px`,
        left: `${props.item.rect.left}px`,
        transform: active
          ? `translate(${props.item.targetRect.left - props.item.rect.left}px, ${
              props.item.targetRect.top - props.item.rect.top
            }px) scale(0.3)`
          : "translate(0, 0) scale(1)",
        opacity: active ? 0 : 1,
      }}
    >
      {props.item.icon === "check" ? <Check size={14} /> : null}
      {props.item.icon === "file" ? <FileText size={14} /> : null}
      {props.item.icon === "folder" ? <Folder size={14} /> : null}
      <span className={flyoutItemClass.label}>
        {props.item.label}
      </span>
    </div>
  );
}
