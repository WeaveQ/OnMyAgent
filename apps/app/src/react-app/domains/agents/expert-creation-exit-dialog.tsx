/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";

export function ExpertCreationExitDialog(props: {
  open: boolean;
  hasKnowledge: boolean;
  onContinue: () => void;
  onKeepAndExit: () => void;
  onDiscardAndExit: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => {
      if (!open) props.onContinue();
    }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("agents.expert_creation_exit_title")}</DialogTitle>
          <DialogDescription>
            {props.hasKnowledge
              ? t("agents.expert_creation_exit_with_knowledge")
              : t("agents.expert_creation_exit_desc")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" size="lg" variant="outline" onClick={props.onContinue}>
            {t("agents.expert_creation_continue_editing")}
          </Button>
          <Button type="button" size="lg" variant="destructive" onClick={props.onDiscardAndExit}>
            {t("agents.expert_creation_discard_exit")}
          </Button>
          <Button type="button" size="lg" onClick={props.onKeepAndExit}>
            {t("agents.expert_creation_keep_exit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
