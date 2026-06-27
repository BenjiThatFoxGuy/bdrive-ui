import { memo, useEffect, useMemo, useRef } from "react";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  FbActions,
  FileBrowser,
  type FileBrowserHandle,
  FileContextMenu,
  FileHelper,
  FileList,
  FileNavbar,
  FileToolbar,
} from "@tw-material/file-browser";
import type {
  StateSnapshot,
  VirtuosoGridHandle,
  VirtuosoHandle,
} from "react-virtuoso";
import useBreakpoint from "use-breakpoint";

import {
  CustomActions,
  fileActions,
  useFileAction,
} from "@/hooks/use-file-action";
import { chainLinks } from "@/utils/common";
import {
  BREAKPOINTS,
  defaultSortState,
  defaultViewId,
  sortViewMap,
} from "@/utils/defaults";
import { fileQueries, useServerConfig, useSession } from "@/utils/query-options";
import { useFileUploadStore, useModalStore } from "@/utils/stores";

import { FileOperationModal } from "./modals/file-operation";
import PreviewModal from "./modals/preview";
import { Upload } from "./upload";
import { UploadDropzone } from "./upload/drop-zone";
import type { BrowseView, FileListParams } from "@/types";

let firstRender = true;

function isVirtuosoList(value: any): value is VirtuosoHandle {
  return (value as VirtuosoHandle).getState !== undefined;
}

const modalFileActions = [
  FbActions.RenameFile.id,
  FbActions.CreateFolder.id,
  FbActions.DeleteFiles.id,
  CustomActions.ShareFiles.id,
];

const fileRoute = getRouteApi("/_authed/$view");

const positions = new Map<string, StateSnapshot>();

export const DriveFileBrowser = memo(() => {
  const { view } = fileRoute.useParams();

  const search = fileRoute.useSearch();

  const navigate = useNavigate();

  const listRef = useRef<VirtuosoHandle | VirtuosoGridHandle>(null);

  const fileBrowserRef = useRef<FileBrowserHandle>(null);

  const [session] = useSession();

  const queryParams: FileListParams = {
    view: view as BrowseView,
    params: search,
  };
  const queryOptions = fileQueries.list(queryParams, session?.hash);

  const modalOpen = useModalStore((state) => state.open);

  const modalOperation = useModalStore((state) => state.operation);

  const openUpload = useFileUploadStore((state) => state.uploadOpen);

  const { breakpoint } = useBreakpoint(BREAKPOINTS);

  const {
    data: files,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSuspenseInfiniteQuery(queryOptions);

  const actionHandler = useFileAction(queryParams, session!);

  const folderChain = useMemo(() => {
    if (view === "my-drive") {
      return chainLinks(search?.path || "").map(([name, path], index) => ({
        id: index + name,
        name,
        path,
        isDir: true,
        chain: true,
      }));
    }

    // For search and recent views, if we have a selected file, show path to its parent
    if ((view === "search" || view === "recent") && search?.selectId && files) {
      const selectedFile = files.find((file) => file?.id === search?.selectId);
      const isDir: boolean = !!selectedFile && FileHelper.isDirectory(selectedFile);
      if (selectedFile && !isDir) {
        // We want to show the path to the parent folder of the selected file
        let filePath = selectedFile.path; // e.g., "/Editing Assets/MMD/file.txt"
        // Get the parent directory path
        let parentPath = "";
        if (filePath) {
          // Remove trailing slash if present
          if (filePath.endsWith("/")) {
            filePath = filePath.slice(0, -1);
          }
          const lastSlash = filePath.lastIndexOf("/");
          if (lastSlash >= 0) {
            parentPath = filePath.slice(0, lastSlash);
          }
          // If the file is at the root, then parentPath will be empty string -> root
          if (parentPath === "") {
            parentPath = "/";
          }
        }
        // Now generate the chain for parentPath
        if (parentPath === "") {
          return [{ id: "root", name: "My Drive", path: "/", isDir: true, chain: true }];
        }
        return chainLinks(parentPath).map(([name, path], index) => ({
          id: index + name,
          name,
          path,
          isDir: true,
          chain: true
        }));
      }
    }

    // For browse view, if we're viewing folder contents (have parentId)
    if (view === "browse" && search?.parentId) {
      // Show placeholder for current folder - in future could resolve actual path
      return [{ id: "current", name: "Folder", path: "", isDir: true, chain: true }];
    }

    return [];
  }, [search?.path, search?.selectId, search?.parentId, view, files]);

  const { zipDownloadEnabled } = useServerConfig();

  const scopedFileActions = useMemo(() => {
    let actions = fileActions;
    // Show in search, recent, browse, starred, and shared views; hide in my-drive only
    if (!(view === "search" || view === "recent" || view === "browse" || view === "starred" || view === "shared")) {
      actions = actions.filter((action) => action.id !== CustomActions.ShowInFolder.id);
    }
    if (!zipDownloadEnabled) {
      actions = actions.filter((action) => action.id !== CustomActions.DownloadAsZip.id);
    }
    return actions;
  }, [view, zipDownloadEnabled]);

  useEffect(() => {
    const selectId = search?.selectId;
    if (!selectId || !files?.some((file) => file?.id === selectId)) return;

    fileBrowserRef.current?.setFileSelection(new Set([selectId]), true);
    navigate({
      to: "/$view",
      params: { view },
      // prev is the router-wide search union (sort widens to string), so pin it
      // back to this route's params type after clearing selectId.
      search: (prev) =>
        ({ ...prev, selectId: undefined }) as FileListParams["params"],
      replace: true,
    });
  }, [search?.selectId, files, navigate, view]);

  useEffect(() => {
    if (firstRender) {
      firstRender = false;
      return;
    }

    setTimeout(() => {
      listRef.current?.scrollTo({
        top: positions.get(view + search?.path || "")?.scrollTop ?? 0,
        left: 0,
      });
    }, 0);

    return () => {
      if (listRef.current && isVirtuosoList(listRef.current)) {
        listRef.current?.getState((state) =>
          positions.set(view + search?.path || "", state),
        );
      }
    };
  }, [search?.path, view]);

  return (
    <div className="size-full m-auto relative">
      <UploadDropzone isDisabled={view !== "my-drive"}>
        <FileBrowser
          ref={fileBrowserRef}
          files={files}
          folderChain={folderChain}
          onFileAction={actionHandler()}
          fileActions={scopedFileActions}
          defaultFileViewActionId={defaultViewId}
          defaultSortActionId={
            view === "my-drive"
              ? defaultSortState.sortId
              : sortViewMap[view].sortId
          }
          defaultSortOrder={
            view === "my-drive"
              ? defaultSortState.order
              : sortViewMap[view].order
          }
          breakpoint={breakpoint}
        >
          {view === "my-drive" && <FileNavbar breakpoint={breakpoint} />}
          <FileToolbar className={view !== "my-drive" ? "pt-2" : ""} />
          <FileList
            hasNextPage={hasNextPage}
            isNextPageLoading={isFetchingNextPage}
            loadNextPage={fetchNextPage}
            ref={listRef}
          />
          <FileContextMenu />
        </FileBrowser>
      </UploadDropzone>

      {modalFileActions.find((val) => val === modalOperation) && modalOpen && (
        <FileOperationModal queryKey={queryOptions.queryKey} />
      )}

      {modalOperation === FbActions.OpenFiles.id && modalOpen && (
        <PreviewModal
          session={session!}
          files={files}
          path={search?.path || ""}
          view={view as BrowseView}
        />
      )}
      {openUpload && <Upload queryKey={queryOptions.queryKey} />}
    </div>
  );
});
