/** @jsxImportSource react */
import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * @deprecated Prefer `Input` / `InputGroup` from `@/components/ui/input`
 * (`DESIGN.md` § 4i / theme-system canonical table). Do not add new call sites.
 *
 * Implementation now wraps the canonical `Input` atom so remaining call sites
 * stay visually aligned while migrating off this composite.
 */
export type TextInputProps = ComponentProps<"input"> & {
  label?: string;
  hint?: string;
  wrapperClassName?: string;
};

/** @deprecated Prefer `Input` / `InputGroup` from `@/components/ui/input`. */
export function TextInput({
  label,
  hint,
  className,
  wrapperClassName,
  ref,
  ...rest
}: TextInputProps) {
  return (
    <label className={wrapperClassName ?? "block"}>
      {label ? (
        <div className="mb-1 text-xs font-medium text-dls-secondary">{label}</div>
      ) : null}
      <Input ref={ref} variant="dls" className={cn(className)} {...rest} />
      {hint ? <div className="mt-1 text-xs text-dls-secondary">{hint}</div> : null}
    </label>
  );
}
