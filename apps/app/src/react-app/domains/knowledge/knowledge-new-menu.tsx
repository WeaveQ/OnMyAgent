/** @jsxImportSource react */
import {
  FilePlus2,
  FolderPlus,
  Sheet,
  Upload,
} from "lucide-react";

import {
  pickDirectory,
  pickFile,
} from "../../../app/lib/desktop";
import type { KnowledgeVaultScope } from "../../../app/lib/desktop";
import {
  uploadKnowledgeFiles,
  uploadKnowledgeFolderFromDisk,
} from "../../../app/lib/desktop-knowledge-upload";
import { t } from "../../../i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type KnowledgeNewMenuProps = {
  scope: KnowledgeVaultScope;
  workspaceId?: string;
  expertId?: string;
  destFolder?: string;
  onNewNote: (folder: string) => void;
  onNewCsv: (folder: string) => void;
  onNewFolder: (folder: string) => void;
  onUploaded: () => void;
};

export function KnowledgeNewMenu(props: KnowledgeNewMenuProps) {
  const folder = props.destFolder ?? "";

  const handleUploadFiles = async () => {
    const picked = await pickFile({ multiple: true });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    const files = paths.map((p) => ({
      name: p.split(/[\\/]/).pop() ?? p,
      sourcePath: p,
    }));
    await uploadKnowledgeFiles({
      scope: props.scope,
      destFolder: folder,
      files,
      workspaceId: props.workspaceId,
      expertId: props.expertId,
    });
    props.onUploaded();
  };

  const handleUploadFolder = async () => {
    const picked = await pickDirectory({ title: t("knowledge.upload_folder") });
    const sourcePath = Array.isArray(picked) ? picked[0] : picked;
    if (!sourcePath) return;
    await uploadKnowledgeFolderFromDisk({
      scope: props.scope,
      sourcePath,
      destFolder: folder,
      workspaceId: props.workspaceId,
      expertId: props.expertId,
    });
    props.onUploaded();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-dls-secondary hover:text-dls-text"
            aria-label={t("knowledge.new_menu")}
            title={t("knowledge.new_menu")}
          >
            <FilePlus2 className="size-3.5" strokeWidth={1.75} />
          </Button>
        }
      />
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuItem className="gap-2" onClick={() => props.onNewNote(folder)}>
          <FilePlus2 className="size-3.5 shrink-0 text-dls-secondary" />
          {t("knowledge.new_note")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={() => props.onNewCsv(folder)}>
          <Sheet className="size-3.5 shrink-0 text-dls-secondary" />
          {t("knowledge.new_csv")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={() => props.onNewFolder(folder)}>
          <FolderPlus className="size-3.5 shrink-0 text-dls-secondary" />
          {t("knowledge.new_folder")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onClick={() => void handleUploadFiles()}>
          <Upload className="size-3.5 shrink-0 text-dls-secondary" />
          {t("knowledge.upload_files")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={() => void handleUploadFolder()}>
          <Upload className="size-3.5 shrink-0 text-dls-secondary" />
          {t("knowledge.upload_folder")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
