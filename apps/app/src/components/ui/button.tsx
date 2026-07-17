import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none titlebar-no-drag focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-dls-status-danger-border aria-invalid:ring-3 aria-invalid:ring-dls-danger/20 dark:aria-invalid:border-dls-status-danger-border dark:aria-invalid:ring-dls-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 relative",
  {
    variants: {
      variant: {
        default: "bg-dls-decision text-white hover:bg-dls-decision-hover bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-lg active:not-aria-[haspopup]:translate-y-px",
        outline:
          "border-dls-border bg-dls-surface-muted/20 hover:bg-dls-surface-muted hover:border-foreground/20 hover:text-dls-text aria-expanded:bg-dls-surface-muted aria-expanded:text-dls-text dark:bg-dls-surface-muted/20 dark:hover:bg-input/30 dark:hover:border-input/80 bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-lg active:not-aria-[haspopup]:translate-y-px",
        dashed:
          "border-dashed border-dls-border bg-dls-surface-muted/20 text-dls-secondary hover:border-dls-border-strong hover:bg-dls-surface-muted hover:text-dls-text bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-lg active:not-aria-[haspopup]:translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground active:not-aria-[haspopup]:translate-y-px",
        ghost:
          "hover:text-dls-text aria-expanded:text-dls-text",
        destructive:
          "border-dls-border text-dls-danger hover:bg-dls-danger-soft hover:border-dls-status-danger-border focus-visible:border-dls-status-danger-border focus-visible:ring-dls-danger/20 dark:border-dls-border dark:hover:bg-dls-danger-soft dark:border-dls-status-danger-border dark:focus-visible:ring-dls-danger/40 bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-lg active:not-aria-[haspopup]:translate-y-px",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5 rounded-lg",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 [&_svg:not([class*='size-'])]:size-3",
        "pill-xs": "h-6 gap-1 rounded-full px-3 text-xs font-medium has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2 rounded-lg",
        lg: "h-10 gap-1.5 px-6 has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-3 rounded-xl",
        xl: "h-11 gap-1.5 px-6 text-sm font-medium rounded-xl has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
