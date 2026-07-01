/** @jsxImportSource react */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "../../../i18n";
import { APP_NAME, APP_NAME_LOWER } from "../../../i18n/locales/brand";

const SUPPORT_EMAIL = `team@${APP_NAME_LOWER}labs.com`;
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=OnMyAgent%20Den%20remote%20worker%20upgrade`;

/**
 * Small inline link rendered inside the remote-worker error card. When clicked,
 * it opens a dialog explaining the OnMyAgent Den upgrade situation and how to
 * reach support.
 */
export function OnMyAgentDenHelpLink() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="xs"
        className="mt-2 h-auto px-0 font-medium text-dls-accent underline-offset-2"
        onClick={() => setOpen(true)}
      >
        {t("workspace.den_help_link")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("workspace.den_help_title")}</DialogTitle>
            <DialogDescription>
              {t("workspace.den_help_description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm leading-5 text-dls-secondary">
            <p>{t("workspace.den_help_options_intro")}</p>
            <ul className="ml-4 list-disc space-y-2">
              <li>
                {t("workspace.den_help_email_prefix")}{" "}
                <a
                  href={SUPPORT_MAILTO}
                  className="font-medium text-dls-accent hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>{" "}
                {t("workspace.den_help_email_suffix")}
              </li>
              <li>
                {t("workspace.den_help_feedback_prefix")}{" "}
                <span className="font-medium text-dls-text">{t("session.support_feedback")}</span>{" "}
                {t("workspace.den_help_feedback_suffix")}
              </li>
            </ul>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("common.close")}
            </DialogClose>
            <Button
              type="button"
              onClick={() => {
                window.location.href = SUPPORT_MAILTO;
              }}
            >
              {t("workspace.den_help_email_support")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
