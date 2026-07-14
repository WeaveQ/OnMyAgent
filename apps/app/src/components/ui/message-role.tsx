import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import {
  AlertCircle,
  Info,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Shared message-role chrome — DESIGN.md § 4c.
 * Use for session transcript rows and local ChatBubble role blocks.
 */
export type MessageRole =
  | "user"
  | "assistant"
  | "tool-call"
  | "tool-output"
  | "thinking"
  | "system"
  | "error"

const messageRoleRowVariants = cva("rounded-lg text-dls-text", {
  variants: {
    role: {
      user: "bg-dls-surface text-sm",
      assistant: "bg-dls-surface text-sm",
      "tool-call": "border-l-2 border-l-dls-primary bg-dls-surface-muted font-mono text-xs",
      "tool-output": "border-l-2 border-l-dls-slate bg-dls-surface-muted font-mono text-xs",
      thinking: "border-l-2 border-l-dls-signal bg-dls-surface text-xs italic text-dls-secondary",
      system: "bg-dls-app-bg text-xs text-dls-secondary",
      error: "border-l-2 border-l-dls-danger bg-dls-surface text-sm text-dls-status-danger-fg",
    },
  },
  defaultVariants: {
    role: "assistant",
  },
})

const rolePrefixIcon: Record<MessageRole, typeof Wrench | null> = {
  user: null,
  assistant: null,
  "tool-call": Wrench,
  "tool-output": Terminal,
  thinking: Sparkles,
  system: Info,
  error: AlertCircle,
}

const rolePrefixClass: Record<MessageRole, string> = {
  user: "",
  assistant: "",
  "tool-call": "text-dls-primary",
  "tool-output": "text-dls-slate",
  thinking: "text-dls-signal",
  system: "text-dls-secondary",
  error: "text-dls-status-danger-fg",
}

function MessageRoleRow({
  className,
  role = "assistant",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof messageRoleRowVariants>) {
  return (
    <div
      data-slot="message-role-row"
      data-message-role={role}
      className={cn(messageRoleRowVariants({ role }), className)}
      {...props}
    />
  )
}

function MessageRolePrefix({
  role,
  className,
  ...props
}: ComponentProps<"span"> & { role: MessageRole }) {
  const Icon = rolePrefixIcon[role]
  if (!Icon) return null
  return (
    <span
      data-slot="message-role-prefix"
      className={cn("inline-flex shrink-0 items-center", rolePrefixClass[role], className)}
      {...props}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  )
}

export { MessageRoleRow, MessageRolePrefix, messageRoleRowVariants }
