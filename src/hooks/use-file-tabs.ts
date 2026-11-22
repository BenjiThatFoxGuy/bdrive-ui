import { useEffect, useRef, type MouseEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { FbActions, type FileData } from "@tw-material/file-browser";
import toast from "react-hot-toast";
import type { FileListParams, ShareListParams } from "@/types";
import { canOpenInNewTab, fileTabDestination } from "@/utils/file-tab-destination";
import { useModalStore } from "@/utils/stores";

export function useOpenFileTabs(context: FileListParams | ShareListParams) {
  const router = useRouter();
  return (files: readonly FileData[]) => {
    let blocked = 0;
    for (const file of new Map(files.map((file) => [file.id, file])).values()) {
      const destination = fileTabDestination(context, file);
      if (!destination) continue;
      const href = router.buildLocation(destination).href;
      // Stay inside the initiating click. Isolate the new document before navigating.
      const tab = window.open("about:blank", "_blank");
      if (!tab) {
        blocked++;
        continue;
      }
      tab.opener = null;
      tab.location.replace(new URL(href, window.location.href).href);
    }
    if (blocked) toast.error(`Your browser blocked ${blocked} tab${blocked === 1 ? "" : "s"}. Allow pop-ups for BDrive and try again.`);
  };
}

export function useMiddleClickFile(files: readonly (FileData | null)[], open: (files: FileData[]) => void) {
  function getFile(event: MouseEvent) {
    if (event.button !== 1 || !(event.target instanceof Element)) return;
    const entry = event.target.closest<HTMLElement>('[data-test-id="file-entry"][data-file-id]');
    if (!entry || !event.currentTarget.contains(entry)) return;
    return files.find((file) => file?.id === entry.dataset.fileId);
  }
  return {
    onMouseDownCapture(event: MouseEvent) {
      if (canOpenInNewTab(getFile(event) ?? null)) event.preventDefault();
    },
    onAuxClick(event: MouseEvent) {
      const file = getFile(event);
      if (!canOpenInNewTab(file ?? null) || !file) return;
      event.preventDefault();
      open([file]);
    },
  };
}

export function usePreviewFromUrl({ previewId, files, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage }: {
  previewId?: string;
  files: readonly (FileData | null)[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
}) {
  const opened = useRef<string>();
  const setModal = useModalStore((state) => state.actions.set);
  useEffect(() => {
    if (typeof previewId !== "string" || !previewId) {
      opened.current = undefined;
      return;
    }
    if (opened.current === previewId) return;
    const file = files.find((file) => file?.id === previewId);
    if (file && !file.isDir && !file.isZip && file.openable !== false) {
      opened.current = previewId;
      setModal({ open: true, currentFile: file, operation: FbActions.OpenFiles.id });
    } else if (!file && isFetchingNextPage) {
      return;
    } else if (!file && hasNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    } else {
      opened.current = previewId;
      toast.error("Couldn't open this preview.");
    }
  }, [previewId, files, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, setModal]);
}
