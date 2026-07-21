import type { ComponentProps, ReactNode } from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const menuRowButtonVariants = cva(
  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      active: {
        // Neutral wash — avoid light-theme blue hover (#EEF4FF) looking like a selected chip.
        true: "bg-dls-surface-muted text-dls-text",
        false: "text-dls-secondary hover:bg-dls-surface-muted/70",
      },
      align: {
        start: "items-start",
        center: "items-center",
      },
      density: {
        // Keep text-sm across composer flyouts (tools / access / workspace pickers).
        default: "px-3 py-2.5 text-sm",
        compact: "px-2.5 py-1.5 text-sm",
      },
    },
    defaultVariants: {
      active: false,
      align: "start",
      density: "default",
    },
  }
)

const navTabButtonVariants = cva(
  // items-center + fixed svg box keeps icon/label on one baseline (avoids floaty icons in header tabs).
  "inline-flex cursor-pointer items-center justify-center gap-1.5 font-medium leading-none transition-colors outline-none select-none titlebar-no-drag focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      active: {
        // Both themes: high-contrast inverted pill so free-float header tabs stay readable.
        true: "bg-dls-text text-dls-background shadow-none [&_svg]:opacity-100",
        false:
          "bg-transparent text-dls-secondary hover:bg-dls-hover/70 hover:text-dls-text [&_svg]:opacity-90",
      },
      size: {
        // ~+2px horizontal padding vs prior px-* for a less tight pill.
        default: "h-8 gap-1.5 px-3.5 text-xs",
        // Compact filter chip (store/assistant/management primary filters)
        filter: "h-7 shrink-0 gap-1.5 px-3 text-xs font-medium",
        // Default page/header tab height (store / files / management).
        tab: "h-8 gap-1.5 px-3.5 text-sm",
        messaging: "h-10 gap-2 px-4.5 text-base font-semibold",
        underline: "h-auto gap-1.5 px-3.5 pb-2 pt-0 text-sm font-semibold",
      },
      shape: {
        // Nested inside SegmentedTabGroup track (rounded-xl + p-0.5).
        // Keep lg (not full) so end segments follow the track without sausage ends.
        pill: "rounded-lg",
        tab: "rounded-lg",
        underline: "rounded-none border-b-2 border-transparent bg-transparent shadow-none",
      },
    },
    compoundVariants: [
      {
        active: true,
        shape: "underline",
        className:
          "border-dls-accent bg-transparent text-dls-text shadow-none hover:bg-transparent dark:bg-transparent dark:text-dls-text",
      },
      {
        active: false,
        shape: "underline",
        className: "hover:bg-transparent",
      },
    ],
    defaultVariants: {
      active: false,
      size: "default",
      shape: "pill",
    },
  }
)

const segmentedTabButtonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors outline-none select-none titlebar-no-drag focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      active: {
        true: "",
        false: "",
      },
      tone: {
        default: "",
        // Soft filter chip: selected elevated solid pill; idle is plain text (no border).
        chip: "rounded-full",
      },
      size: {
        // Align with NavTab ~+2px horizontal padding.
        default: "px-3.5 py-2 text-xs",
        compact: "px-3.5 py-1.5 text-xs",
        comfortable: "px-4 py-1.5 text-sm font-medium",
        // Compact hug pill for category filters / memory multi-select.
        chip: "h-7 min-h-7 gap-1.5 px-3 text-xs font-medium",
      },
      width: {
        fill: "flex-1",
        hug: "flex-none",
      },
    },
    compoundVariants: [
      {
        // Match NavTab: light inverted dark pill; dark elevated solid.
        tone: "default",
        active: true,
        className:
          "bg-dls-text text-dls-background shadow-none dark:bg-dls-surface-solid dark:text-dls-text",
      },
      {
        tone: "default",
        active: false,
        className: "bg-transparent text-dls-secondary hover:text-dls-text",
      },
      {
        // Light free-float filters: soft gray solid pill (not elevated white).
        // Dark: same list-selected wash. Idle stays plain label.
        tone: "chip",
        active: true,
        className: "bg-dls-list-selected text-dls-text shadow-none",
      },
      {
        tone: "chip",
        active: false,
        className:
          "bg-transparent text-dls-secondary hover:bg-dls-list-hover/50 hover:text-dls-text",
      },
    ],
    defaultVariants: {
      active: false,
      tone: "default",
      size: "default",
      width: "fill",
    },
  }
)

const actionRowButtonVariants = cva(
  "flex w-full items-start gap-3 rounded-xl border border-dls-border bg-dls-surface p-3.5 text-left transition-colors outline-none hover:bg-dls-hover focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      density: {
        default: "p-3.5",
        card: "p-4",
        compact: "px-3 py-2.5",
        row: "px-4 py-3",
        access: "min-h-20 px-5 py-4",
        settingsCard: "h-24 p-4",
        agentTemplate: "h-[198px] flex-col p-5",
        addCard: "min-h-[276px] flex-col items-center justify-center px-8",
        assignment: "mt-7 items-center gap-4 px-5 py-5",
        prompt: "min-h-14 rounded-lg px-3 py-2 text-sm leading-5",
        spacious: "px-5 py-5",
      },
    },
    defaultVariants: {
      density: "default",
    },
  }
)

const disclosureRowButtonVariants = cva(
  "flex w-full items-center gap-3.5 text-left transition-colors outline-none hover:bg-dls-surface-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      density: {
        default: "px-4 py-3.5",
        compact: "px-3 py-2.5",
        spacious: "px-5 py-4",
        flush: "p-0",
      },
    },
    defaultVariants: {
      density: "default",
    },
  }
)

const navListButtonVariants = cva(
  "flex w-full items-center text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      active: {
        // Match assistant task-row selection (bg-dls-list-selected), not surface-muted.
        true: "bg-dls-list-selected text-dls-text",
        false: "text-dls-text hover:bg-dls-list-hover",
      },
      size: {
        default: "h-10 gap-2.5 rounded-xl px-2.5 text-base font-medium",
        sidebar: "h-9 gap-2 rounded-xl px-2.5 text-sm font-normal",
        compact: "h-7 gap-2 rounded-lg px-2 text-xs font-medium",
      },
    },
    compoundVariants: [
      {
        active: true,
        size: "sidebar",
        // Soft pill radius aligns with task cards (rounded-lg).
        className: "rounded-lg font-medium",
      },
    ],
    defaultVariants: {
      active: false,
      size: "default",
    },
  }
)

const railButtonVariants = cva(
  "flex flex-col items-center justify-center font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      active: {
        true: "text-dls-accent",
        false: "text-dls-secondary hover:text-dls-accent",
      },
      size: {
        top: "min-h-12 w-[60px] gap-1 rounded-xl px-1.5 text-xs",
        bottom: "size-10 gap-1 rounded-lg text-2xs",
      },
    },
    defaultVariants: {
      active: false,
      size: "top",
    },
  }
)

const treeRowButtonVariants = cva(
  "flex w-full items-center gap-2 text-left text-dls-text transition-colors outline-none hover:bg-dls-hover focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      depth: {
        root: "px-4 py-2 text-sm font-medium",
        child: "px-8 py-1.5 text-sm",
      },
    },
    defaultVariants: {
      depth: "root",
    },
  }
)

const sessionRowButtonVariants = cva(
  "w-full text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      active: {
        true: "bg-dls-list-selected text-dls-text",
        false: "text-dls-text hover:bg-dls-hover",
      },
      size: {
        conversation: "flex h-[68px] items-center gap-3 px-4",
        // Agent session strip: solid chip (contrast vs outline "+ 新会话"); radius matches search.
        tab: "flex h-7 w-[116px] items-center gap-1 rounded-md border-0 px-3 pr-7 text-xs",
      },
      muted: {
        true: "bg-transparent text-dls-secondary",
        false: "",
      },
    },
    compoundVariants: [
      {
        size: "tab",
        active: true,
        className: "bg-dls-list-selected font-medium text-dls-text shadow-none",
      },
      {
        size: "tab",
        active: false,
        muted: false,
        // Soft solid chip when idle — still distinct from outline "new session" action.
        className:
          "bg-dls-surface-muted/70 text-dls-secondary hover:bg-dls-list-hover/50 hover:text-dls-text",
      },
    ],
    defaultVariants: {
      active: false,
      size: "conversation",
      muted: false,
    },
  }
)

const matrixButtonVariants = cva(
  // Header + cell share the same full-track box so glyphs line up under column icons.
  "relative flex h-full w-full min-w-0 items-center justify-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      kind: {
        cell: "group/cell",
        // No border-l here — column rules are drawn by the shared track wrapper.
        header: "h-11 flex-col gap-0.5 text-2xs",
      },
      active: {
        true: "font-semibold text-dls-text",
        false: "text-dls-secondary hover:bg-dls-hover/60",
      },
      interactive: {
        true: "cursor-pointer",
        false: "cursor-default",
      },
    },
    defaultVariants: {
      kind: "cell",
      active: false,
      interactive: true,
    },
  }
)

const iconTileVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:shrink-0",
  {
    variants: {
      size: {
        "2xs": "size-5",
        xs: "size-6",
        sm: "size-8",
        default: "size-9",
        md: "size-10",
        lg: "size-11",
        "2xl": "size-16",
        "3xl": "size-24",
      },
      tone: {
        neutral: "bg-dls-hover text-dls-secondary",
        accent: "bg-dls-decision-soft text-dls-accent",
        softAccent: "bg-dls-accent/10 text-dls-accent",
        info: "bg-dls-accent/10 text-dls-accent",
        surface: "bg-dls-surface text-dls-secondary",
      },
      shape: {
        md: "rounded-md",
        lg: "rounded-lg",
        xl: "rounded-xl",
        circle: "rounded-full",
      },
      border: {
        true: "border border-dls-border",
        false: "",
      },
    },
    defaultVariants: {
      size: "sm",
      tone: "neutral",
      shape: "lg",
      border: false,
    },
  }
)

function MenuRowButton({
  className,
  active = false,
  align = "start",
  density = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof menuRowButtonVariants>) {
  return <ButtonPrimitive className={cn(menuRowButtonVariants({ active, align, density }), className)} {...props} />
}

function MenuRowSurface({
  className,
  active = false,
  align = "start",
  density = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof menuRowButtonVariants>) {
  return <div className={cn(menuRowButtonVariants({ active, align, density }), className)} {...props} />
}

function NavTabButton({
  className,
  active = false,
  size = "default",
  shape = "pill",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof navTabButtonVariants>) {
  return <ButtonPrimitive className={cn(navTabButtonVariants({ active, size, shape }), className)} {...props} />
}

function SegmentedTabButton({
  className,
  active = false,
  tone = "default",
  size = "default",
  width = "fill",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof segmentedTabButtonVariants>) {
  return <ButtonPrimitive className={cn(segmentedTabButtonVariants({ active, tone, size, width }), className)} {...props} />
}

/** Soft free-floating filter chip: solid pill when active, plain label when idle. */
function FilterChip({
  className,
  selected = false,
  label,
  ...props
}: Omit<ButtonPrimitive.Props, "children"> & {
  selected?: boolean
  label: ReactNode
}) {
  return (
    <SegmentedTabButton
      type="button"
      active={selected}
      tone="chip"
      size="chip"
      width="hug"
      aria-pressed={selected}
      className={className}
      {...props}
    >
      {label}
    </SegmentedTabButton>
  )
}

const segmentedTabGroupVariants = cva("inline-flex items-center", {
  variants: {
    density: {
      // Compact filter strip (assistant office/code track).
      // Track radius must nest NavTab shape=tab (rounded-lg + p-0.5):
      // outer ≈ inner + padding → rounded-xl, not rounded-full sausage.
      filter:
        "h-8 w-fit shrink-0 gap-0.5 rounded-xl border border-dls-border/50 bg-dls-surface-muted p-0.5",
      // In-page multi-tab (may wrap; slightly taller track)
      panel:
        "h-9 max-w-full flex-wrap gap-0.5 rounded-xl border border-dls-border/50 bg-dls-surface-muted p-0.5",
      // Header tabs without track — free-floating active pill only (store/files/management)
      bare: "h-8 w-fit shrink-0 items-center gap-0.5 border-0 bg-transparent p-0",
    },
  },
  defaultVariants: {
    density: "filter",
  },
})

function SegmentedTabGroup({
  className,
  density = "filter",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof segmentedTabGroupVariants>) {
  return (
    <div
      className={cn(segmentedTabGroupVariants({ density }), className)}
      {...props}
    />
  )
}

function ActionRowButton({
  className,
  density = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof actionRowButtonVariants>) {
  return <ButtonPrimitive className={cn(actionRowButtonVariants({ density }), className)} {...props} />
}

function DisclosureRowButton({
  className,
  density = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof disclosureRowButtonVariants>) {
  return <ButtonPrimitive className={cn(disclosureRowButtonVariants({ density }), className)} {...props} />
}

function NavListButton({
  className,
  active = false,
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof navListButtonVariants>) {
  return <ButtonPrimitive className={cn(navListButtonVariants({ active, size }), className)} {...props} />
}

function RailButton({
  className,
  active = false,
  size = "top",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof railButtonVariants>) {
  return <ButtonPrimitive className={cn(railButtonVariants({ active, size }), className)} {...props} />
}

function TreeRowButton({
  className,
  depth = "root",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof treeRowButtonVariants>) {
  return <ButtonPrimitive className={cn(treeRowButtonVariants({ depth }), className)} {...props} />
}

function SessionRowButton({
  className,
  active = false,
  size = "conversation",
  muted = false,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof sessionRowButtonVariants>) {
  return <ButtonPrimitive className={cn(sessionRowButtonVariants({ active, size, muted }), className)} {...props} />
}

function MatrixButton({
  className,
  kind = "cell",
  active = false,
  interactive = true,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof matrixButtonVariants>) {
  return <ButtonPrimitive className={cn(matrixButtonVariants({ kind, active, interactive }), className)} {...props} />
}

function IconTile({
  className,
  size = "sm",
  tone = "neutral",
  shape = "lg",
  border = false,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof iconTileVariants>) {
  return <div className={cn(iconTileVariants({ size, tone, shape, border }), className)} {...props} />
}

export { ActionRowButton, DisclosureRowButton, FilterChip, IconTile, MatrixButton, MenuRowButton, MenuRowSurface, NavListButton, NavTabButton, RailButton, SegmentedTabButton, SegmentedTabGroup, SessionRowButton, TreeRowButton }
