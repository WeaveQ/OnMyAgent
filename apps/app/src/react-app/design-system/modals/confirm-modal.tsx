/** @jsxImportSource react */
import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  variant?: "danger" | "warning";
  confirmButtonVariant?: "secondary" | "ghost" | "outline" | "destructive";
  cancelButtonVariant?: "secondary" | "ghost" | "outline" | "destructive";
  showCloseButton?: boolean;
  closeLabel?: string;
  secondaryLabel?: string;
  secondaryButtonVariant?: "secondary" | "ghost" | "outline" | "destructive";
  onSecondary?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal(props: ConfirmModalProps) {
  const variant = props.variant ?? "warning";
  const confirmVariant = props.confirmButtonVariant ?? (variant === "danger" ? "destructive" : undefined);
  const cancelVariant = props.cancelButtonVariant ?? "outline";
  const secondaryVariant = props.secondaryButtonVariant ?? "destructive";

  let iconTileClass = "bg-dls-status-warning-soft text-dls-status-warning-fg";
  if (variant === "danger") iconTileClass = "bg-dls-status-danger-soft text-dls-status-danger-fg";

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <AlertDialogContent className={props.showCloseButton ? "relative pt-12" : undefined}>
        {props.showCloseButton ? (
          <AlertDialogCancel
            variant="ghost"
            size="icon"
            className="absolute top-3 end-3 size-8"
            aria-label={props.closeLabel ?? props.cancelLabel}
          >
            <X className="size-4" />
          </AlertDialogCancel>
        ) : null}
        <AlertDialogHeader>
          <AlertDialogMedia className={iconTileClass}>
            <AlertTriangle />
          </AlertDialogMedia>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {props.secondaryLabel ? (
            <Button
              type="button"
              variant={secondaryVariant}
              size="lg"
              onClick={props.onSecondary}
            >
              {props.secondaryLabel}
            </Button>
          ) : (
            <AlertDialogCancel variant={cancelVariant} size="lg">
              {props.cancelLabel}
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            variant={confirmVariant}
            size="lg"
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
