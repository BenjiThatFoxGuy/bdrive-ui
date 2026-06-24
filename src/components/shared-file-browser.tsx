import { memo, useEffect, useMemo, useRef } from "react";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  FbActions,
  FileBrowser,
  FileContextMenu,
  FileList,
  FileNavbar,
  FileToolbar,
} from "@tw-material/file-browser";
import type { StateSnapshot, VirtuosoGridHandle, VirtuosoHandle } from "react-virtuoso";
import useBreakpoint from "use-breakpoint";
import { useSession } from "@/utils/query-options";

import { chainSharedLinks } from "@/utils/common";
import { BREAKPOINTS, defaultViewId } from "@/utils/defaults";
import { shareQueries } from "@/utils/query-options";
import { sharefileActions, useShareFileAction } from "@/hooks/use-file-action";
import { CustomActions } from "@/hooks/use-file-action";
import { useModalStore } from "@/utils/stores";
import PreviewModal from "./modals/preview";
import { $api } from "@/utils/api";

let firstRender = true;

function isVirtuosoList(value: any): value is VirtuosoHandle {
  return (value as VirtuosoHandle).getState !== undefined;
}

const route = getRouteApi("/_share/share/$id");

const positions = new Map<string, StateSnapshot>();

const disabledActions = [
  FbActions.UploadFiles.id,
  FbActions.CreateFolder.id,
  FbActions.CutFiles.id,
  FbActions.SelectMode.id,
  FbActions.PasteFiles.id,
  FbActions.RenameFile.id,
  FbActions.DeleteFiles.id,
];

export const SharedFileBrowser = memo(({ password }: { password: string }) => {
  const { id } = route.useParams();

  const { path } = route.useSearch();

  const listRef = useRef<VirtuosoHandle | VirtuosoGridHandle>(null);

  const { breakpoint } = useBreakpoint(BREAKPOINTS);
  const session = useSession();

  const params = {
    id,
    password,
    path: path || "",
  };

  const {
    data: { name, type, ownerId },
  } = $api.useSuspenseQuery("get", "/shares/{id}", {
    params: {
      path: {
        id,
      },
    },
  });

  const {
    data: files,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSuspenseInfiniteQuery(shareQueries.list(params));

  const actionHandler = useShareFileAction(params);

  // Determine if current user owns this share
  const isOwner = session?.user?.id === ownerId;

  const folderChain = useMemo(() => {
    if (type === "file") {
      return [];
    }
    return chainSharedLinks(name, params.path!).map(([name, path], index) => ({
      id: index + name,
      name,
      path,
      isDir: true,
      chain: true,
    }));
  }, [params.path, name, type]);

  const modalOpen = useModalStore((state) => state.open);

  const modalOperation = useModalStore((state) => state.operation);

  useEffect(() => {
    if (firstRender) {
      firstRender = false;
      return;
    }

    setTimeout(() => {
      listRef.current?.scrollTo({
        top: positions.get(id + path)?.scrollTop ?? 0,
        left: 0,
      });
    }, 0);

    return () => {
      if (listRef.current && isVirtuosoList(listRef.current)) {
        listRef.current?.getState((state) => positions.set(id + path, state));
      }
    };
  }, [id, path]);

  // Show "Show in folder" only for NON-owners (recipients of shares)
  // Owners don't need it for their own shares, and it's a security risk to show it
  // to others viewing shares you shared with them
  const fileActionsForShare = !isOwner ? sharefileActions : sharefileActions.filter(action => action.id !== CustomActions.ShowInFolder.id);

  return (
    <div className="size-full m-auto">
      <FileBrowser
        files={files}
        folderChain={folderChain}
        onFileAction={actionHandler()}
        fileActions={fileActionsForShare}
        breakpoint={breakpoint}
        defaultFileViewActionId={defaultViewId}
        disableEssentailFileActions={disabledActions}
      >
        <FileNavbar breakpoint={breakpoint} />
        <FileToolbar className="pt-2" />
        <FileList
          hasNextPage={hasNextPage}
          isNextPageLoading={isFetchingNextPage}
          loadNextPage={fetchNextPage}
          ref={listRef}
        />
        <FileContextMenu />
      </FileBrowser>
      {modalOperation === FbActions.OpenFiles.id && modalOpen && (
        <PreviewModal shareId={params.id} files={files} view="shared" path="" />
      )}
    </div>
  );
});
