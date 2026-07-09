/** @jsxImportSource react */
import type { ComponentProps } from "react";

/**
 * @deprecated Prefer `Input` / `InputGroup` from `@/components/ui/input`
 * (`DESIGN.md` § 4i / theme-system canonical table). Do not add new call sites.
 */
export type TextInputProps = ComponentProps<"input"> & {
  label?: string;
  hint?: string;
  wrapperClassName?: string;
};

const textInputClass = {
  wrapper: "block",
  label: "mb-1 text-xs font-medium text-dls-secondary",
  input: "w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-sm text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/30",
  hint: "mt-1 text-xs text-dls-secondary",
};

/** @deprecated Prefer `Input` / `InputGroup` from `@/components/ui/input`. */
export function TextInput({ label, hint, className, wrapperClassName, ref, ...rest }: TextInputProps) {
  return (
    <label className={wrapperClassName ?? textInputClass.wrapper}>
      {label ? (
        <div className={textInputClass.label}>
          {label}
        </div>
      ) : null}
      <input
        ref={ref}
        className={`${textInputClass.input} ${
          className ?? ""
        }`.trim()}
        {...rest}
      />
      {hint ? (
        <div className={textInputClass.hint}>{hint}</div>
      ) : null}
    </label>
  );
}
