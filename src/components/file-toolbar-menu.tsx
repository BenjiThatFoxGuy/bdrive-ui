import { useCallback } from "react";
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@tw-material/react";
import MaterialSymbolsMoreVert from "~icons/material-symbols/more-vert";
import Share from "~icons/fluent/share-24-regular";
import MaterialSymbolsFolderOpen from "~icons/material-symbols/folder-open-outline-rounded";
import MaterialSymbolsFolderZip from "~icons/material-symbols/folder-zip-outline-rounded";
import IconMaterialSymbolsStar from "~icons/material-symbols/star-rounded";
import { FbIconName, useFileBrowserContext, FileHelper } from "@tw-material/file-browser";

interface FileToolbarMenuProps {
  onFileAction: (data: any) => Promise<void>;
  view?: string;
  zipDownloadEnabled?: boolean;
}

// Toolbar overflow menu for context menu actions - unified with context menu for consistency
// Actions: Share, Copy Download Link, Show in Folder, Download as Zip, Toggle Star
export function FileToolbarMenu({ onFileAction, view = "", zipDownloadEnabled = true }: FileToolbarMenuProps) {
  const context = useFileBrowserContext();

  if (!context) {
    return null;
  }

  const { state } = context;
  const selectedFiles = state.selectedFiles || [];

  // Only show menu if files are selected
  if (selectedFiles.length === 0) {
    return null;
  }

  const handleAction = useCallback(
    async (actionId: string) => {
      const data = {
        id: actionId,
        state,
        payload: {},
      };
      await onFileAction(data);
    },
    [state, onFileAction]
  );

  // Determine which actions are applicable
  const canShare = selectedFiles.length > 0;
  const canCopyLink = selectedFiles.some((f) => !FileHelper.isDirectory(f));
  const canDownloadZip = selectedFiles.length > 0 && zipDownloadEnabled;
  const canShowInFolder = (view === "search" || view === "recent" || view === "browse" || view === "starred" || view === "shared");
  const canStar = selectedFiles.length > 0;

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          className="text-on-surface"
          aria-label="More actions"
        >
          <MaterialSymbolsMoreVert className="size-5" />
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="File actions"
        onAction={(key) => handleAction(key as string)}
      >
        {canShare && (
          <DropdownItem
            key="share_files"
            startContent={<Share className="size-4" />}
          >
            Share
          </DropdownItem>
        )}
        {canCopyLink && (
          <DropdownItem
            key="copy_link"
            startContent={<FbIconName.copy className="size-4" />}
          >
            Copy Link
          </DropdownItem>
        )}
        {canShowInFolder && (
          <DropdownItem
            key="show_in_folder"
            startContent={<MaterialSymbolsFolderOpen className="size-4" />}
          >
            Show in Folder
          </DropdownItem>
        )}
        {canDownloadZip && (
          <DropdownItem
            key="download_as_zip"
            startContent={<MaterialSymbolsFolderZip className="size-4" />}
          >
            Download as Zip
          </DropdownItem>
        )}
        {canStar && (
          <DropdownItem
            key="toggle_star"
            startContent={<IconMaterialSymbolsStar className="size-4" />}
          >
            Star/Unstar
          </DropdownItem>
        )}
      </DropdownMenu>
    </Dropdown>
  );
}
