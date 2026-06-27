import { useQueryClient } from "@tanstack/react-query";
import { Button, Listbox, ListboxItem } from "@tw-material/react";
import clsx from "clsx";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import IconParkOutlineCloseOne from "~icons/icon-park-outline/close-one";
import IconParkOutlineDownC from "~icons/icon-park-outline/down-c";

import type { components } from "@/lib/api";
import { $api } from "@/utils/api";
import { filesize } from "@/utils/common";
import { useSession } from "@/utils/query-options";
import {
  type ConflictAction,
  FileUploadStatus,
  useFileUploadStore,
} from "@/utils/stores";
import { useSettingsStore } from "@/utils/stores/settings";
import { useSearch } from "@tanstack/react-router";
import type { UploadProps } from "./types";
import {
  checkFileExists,
  computeUploadId,
  deleteUploadParts,
  generateUniqueName,
  uploadFile,
} from "./upload-file";
import { UploadConflictPrompt } from "./upload-conflict-prompt";
import { UploadFileEntry } from "./upload-file-entry";

export const Upload = ({ queryKey }: UploadProps) => {
  const {
    fileIds,
    currentFile,
    collapse,
    fileDialogOpen,
    folderDialogOpen,
    actions,
    fileMap,
    applyToAllAction,
  } = useFileUploadStore(
    useShallow((state) => ({
      fileIds: state.filesIds,
      fileMap: state.fileMap,
      currentFile: state.fileMap[state.currentFileId],
      collapse: state.collapse,
      actions: state.actions,
      fileDialogOpen: state.fileDialogOpen,
      folderDialogOpen: state.folderDialogOpen,
      applyToAllAction: state.applyToAllAction,
    })),
  );

  const isDialogOpening = useRef(false);

  const uploadSummary = useMemo(() => {
    const topLevelIds = fileIds.filter((id) => {
      const file = fileMap[id];
      if (!file) return false;
      const isChildFile =
        file.parentFolderId && fileIds.includes(file.parentFolderId);
      return !isChildFile;
    });

    // Filter out cancelled, failed, and skipped files from progress calculations
    const validFileIds = fileIds.filter((id) => {
      const status = fileMap[id]?.status;
      return (
        status !== FileUploadStatus.CANCELLED &&
        status !== FileUploadStatus.FAILED &&
        status !== FileUploadStatus.SKIPPED
      );
    });

    const validTopLevelIds = topLevelIds.filter((id) => {
      const status = fileMap[id]?.status;
      return (
        status !== FileUploadStatus.CANCELLED &&
        status !== FileUploadStatus.FAILED &&
        status !== FileUploadStatus.SKIPPED
      );
    });

    const folders = validTopLevelIds.filter(
      (id) => fileMap[id]?.isFolder,
    ).length;
    const files = validTopLevelIds.filter(
      (id) => !fileMap[id]?.isFolder,
    ).length;

    const totalSize = validFileIds.reduce(
      (sum, id) => sum + (fileMap[id]?.file.size || 0),
      0,
    );
    const uploadedSize = validFileIds.reduce((sum, id) => {
      const file = fileMap[id];
      // For uploaded files, count as 100% progress
      const progress =
        file?.status === FileUploadStatus.UPLOADED ? 100 : file?.progress || 0;
      return sum + (progress / 100) * (file?.file.size || 0);
    }, 0);

    const totalProgress = totalSize > 0 ? (uploadedSize / totalSize) * 100 : 0;

    return {
      folders,
      files,
      totalProgress,
      totalSize,
      uploadedSize,
    };
  }, [fileIds, fileMap]);

  const topLevelFileIds = useMemo(() => {
    return fileIds.filter((id) => {
      const file = fileMap[id];
      if (!file) return false;
      const isChildFile =
        file.parentFolderId && fileIds.includes(file.parentFolderId);
      return !isChildFile;
    });
  }, [fileIds, fileMap]);

  const { settings } = useSettingsStore();

  const [session] = useSession();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const openFileSelector = useCallback(() => {
    if (!isDialogOpening.current) {
      isDialogOpening.current = true;
      fileInputRef?.current?.click();
      setTimeout(() => {
        isDialogOpening.current = false;
      }, 200);
    }
  }, []);

  const openFolderSelector = useCallback(() => {
    if (!isDialogOpening.current) {
      isDialogOpening.current = true;
      folderInputRef?.current?.click();
      setTimeout(() => {
        isDialogOpening.current = false;
      }, 200);
    }
  }, []);

  useEffect(() => {
    const handleFileSelect = () => {
      actions.setFileDialogOpen(false);
    };

    if (fileDialogOpen) {
      openFileSelector();
      fileInputRef.current?.addEventListener("change", handleFileSelect, {
        once: true,
      });
    }

    return () => {
      fileInputRef.current?.removeEventListener("change", handleFileSelect);
    };
  }, [fileDialogOpen, actions]);

  useEffect(() => {
    const handleFolderSelect = () => {
      actions.setFolderDialogOpen(false);
    };

    if (folderDialogOpen) {
      openFolderSelector();
      folderInputRef.current?.addEventListener("change", handleFolderSelect, {
        once: true,
      });
    }

    return () => {
      folderInputRef.current?.removeEventListener("change", handleFolderSelect);
    };
  }, [folderDialogOpen, actions]);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      actions.handleSelection(event.target.files);
      event.target.value = "";
    },
    [actions],
  );

  const handleFolderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      actions.handleSelection(event.target.files);
      event.target.value = "";
    },
    [actions],
  );

  const queryClient = useQueryClient();

  const creatFile = $api.useMutation("post", "/files", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const { path } = useSearch({ from: "/_authed/$view" });

  // Resolves the destination folder path for a queued item. Top-level files land
  // in the current folder; files inside an uploaded folder use their relative
  // path under it.
  const destPathFor = useCallback(
    (file: (typeof fileMap)[string]) =>
      file.parentFolderId
        ? `${path || "/"}/${file.relativePath?.split("/").slice(0, -1).join("/")}`
        : path || "/",
    [path],
  );

  // Names of active files already present in the currently loaded folder
  // listing. Used as a no-network fast path to confirm an obvious duplicate
  // before falling back to the find endpoint.
  const loadedNames = useMemo(() => {
    const data = queryClient.getQueryData(queryKey) as
      | { pages?: (components["schemas"]["FileList"] | undefined)[] }
      | undefined;
    const names = new Set<string>();
    for (const page of data?.pages ?? []) {
      for (const item of page?.items ?? []) {
        if (item.type === "file") names.add(item.name);
      }
    }
    return names;
  }, [queryClient, queryKey]);

  const detectConflict = useCallback(
    async (file: (typeof fileMap)[string], destPath: string, signal?: AbortSignal) => {
      // Positive matches in the loaded current-folder listing are authoritative;
      // a miss still needs the find endpoint since the listing may be paginated.
      if (destPath === (path || "/") && loadedNames.has(file.file.name)) {
        return true;
      }
      return checkFileExists(destPath, file.file.name, signal);
    },
    [path, loadedNames],
  );

  // Performs the actual chunked upload for a queued file. Duplicate detection has
  // already happened by this point, so the internal check is skipped.
  const startActualUpload = useCallback(
    (file: (typeof fileMap)[string], destPath: string) => {
      const id = file.id;
      actions.setFileUploadStatus(id, FileUploadStatus.UPLOADING);
      uploadFile(
        file.file,
        destPath,
        Number(settings.splitFileSize),
        session?.userId as number,
        Number(settings.uploadConcurrency),
        Number(settings.uploadRetries),
        Number(settings.uploadRetryDelay),
        Boolean(settings.encryptFiles),
        Boolean(settings.randomChunking),
        file.controller.signal,
        (progress) => actions.setProgress(id, progress),
        (chunks) => actions.setChunksCompleted(id, chunks),
        async (payload) => {
          await creatFile.mutateAsync({ body: payload });
          if (creatFile.isSuccess) {
            actions.setFileUploadStatus(id, FileUploadStatus.UPLOADED);
          }
        },
        true, // duplicate detection already handled by the conflict flow
      )
        .then(() => {
          const fresh = useFileUploadStore.getState().fileMap[id];
          if (fresh && fresh.status !== FileUploadStatus.SKIPPED) {
            actions.setFileUploadStatus(id, FileUploadStatus.UPLOADED);
          }
          actions.startNextUpload();
        })
        .catch((error) => {
          if (error.message.includes("aborted")) {
            actions.setFileUploadStatus(id, FileUploadStatus.CANCELLED);
          } else {
            actions.setError(
              id,
              error instanceof Error ? error.message : "upload failed",
            );
            actions.setFileUploadStatus(id, FileUploadStatus.FAILED);
          }
        });
    },
    [actions, creatFile, session, settings],
  );

  // Applies a chosen conflict resolution to a single awaiting file.
  const applyResolution = useCallback(
    async (id: string, action: ConflictAction) => {
      const file = useFileUploadStore.getState().fileMap[id];
      if (!file) return;
      const destPath = destPathFor(file);

      switch (action) {
        case "skip":
          actions.skipFile(id);
          return;
        case "overwrite":
          // Same name + parent; the backend upserts the active record in place.
          actions.requeueResolvedFile(id);
          return;
        case "rename": {
          const newName = await generateUniqueName(file.file.name, (candidate) =>
            checkFileExists(destPath, candidate),
          );
          actions.renameAndRequeue(id, newName);
          return;
        }
        case "cancel": {
          // Clean up any parts already uploaded for the conflicting file, then
          // abort the whole batch.
          const uploadId = await computeUploadId(
            file.file,
            destPath,
            session?.userId as number,
          );
          await deleteUploadParts(uploadId);
          actions.cancelUpload();
          return;
        }
      }
    },
    [actions, destPathFor, session],
  );

  const handleResolveConflict = useCallback(
    (id: string, action: ConflictAction, applyToAll: boolean) => {
      if (applyToAll) {
        actions.setApplyToAllAction(action);
      }
      applyResolution(id, action);
    },
    [actions, applyResolution],
  );

  // Guards against React StrictMode's double-invocation kicking off detection or
  // upload twice for the same item.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (
      !currentFile?.id ||
      currentFile.status !== FileUploadStatus.NOT_STARTED
    ) {
      return;
    }

    const file = currentFile;
    const destPath = destPathFor(file);

    if (file.isFolder) {
      actions.setFileUploadStatus(file.id, FileUploadStatus.UPLOADING);
      creatFile
        .mutateAsync({
          body: {
            name: file.file.name,
            type: "folder",
            path: file.relativePath
              ? `${path || "/"}/${file.relativePath.split("/").slice(0, -1).join("/")}`
              : path || "/",
          },
        })
        .then(() => {
          actions.setFileUploadStatus(file.id, FileUploadStatus.UPLOADED);
          actions.startNextUpload();
        })
        .catch((err) => {
          if (
            err.message.includes("already exists") ||
            err.message.includes("exists")
          ) {
            // Folder already present – reuse it and let children upload into it.
            actions.setFileUploadStatus(file.id, FileUploadStatus.SKIPPED);
            actions.startNextUpload();
          } else {
            actions.setError(file.id, err.message);
            actions.setFileUploadStatus(file.id, FileUploadStatus.FAILED);
          }
        });
      return;
    }

    if (inFlightRef.current.has(file.id)) return;
    inFlightRef.current.add(file.id);

    (async () => {
      try {
        // Files inside an uploaded folder and already-resolved items skip
        // detection.
        const needsCheck = !file.parentFolderId && !file.skipConflictCheck;
        if (needsCheck) {
          let conflict = false;
          try {
            conflict = await detectConflict(
              file,
              destPath,
              file.controller.signal,
            );
          } catch {
            if (file.controller.signal.aborted) {
              const fresh = useFileUploadStore.getState().fileMap[file.id];
              if (fresh) {
                actions.setFileUploadStatus(
                  file.id,
                  FileUploadStatus.CANCELLED,
                );
              }
              return;
            }
            // On detection failure, fall through and attempt the upload.
            conflict = false;
          }

          const fresh = useFileUploadStore.getState().fileMap[file.id];
          if (!fresh || fresh.status !== FileUploadStatus.NOT_STARTED) return;

          if (conflict) {
            const applyAll = useFileUploadStore.getState().applyToAllAction;
            if (applyAll) {
              // Resolve the in-flight item inline. Routing through the parked
              // resolution path would leave the status unchanged and stall the
              // effect, so act directly here.
              if (applyAll === "skip") {
                actions.skipFile(file.id);
              } else if (applyAll === "cancel") {
                await applyResolution(file.id, "cancel");
              } else if (applyAll === "rename") {
                const newName = await generateUniqueName(
                  file.file.name,
                  (candidate) => checkFileExists(destPath, candidate),
                );
                actions.renameAndRequeue(file.id, newName);
                const renamed = useFileUploadStore.getState().fileMap[file.id];
                if (renamed) startActualUpload(renamed, destPath);
              } else {
                // overwrite
                startActualUpload(file, destPath);
              }
            } else {
              // Park this item and continue with the rest of the queue.
              actions.markAwaitingConflict(file.id);
              actions.startNextUpload();
            }
            return;
          }
        }

        startActualUpload(file, destPath);
      } finally {
        inFlightRef.current.delete(file.id);
      }
    })();
  }, [currentFile?.id, currentFile?.status]);

  // When "apply to all" is active, automatically resolve every remaining
  // conflict instead of prompting again. Once the queue has fully drained, the
  // choice is cleared so it does not silently affect a later batch.
  useEffect(() => {
    if (!applyToAllAction) return;
    const awaitingId = fileIds.find(
      (id) => fileMap[id]?.status === FileUploadStatus.AWAITING_CONFLICT,
    );
    if (awaitingId) {
      applyResolution(awaitingId, applyToAllAction);
      return;
    }
    const pending = fileIds.some((id) => {
      const status = fileMap[id]?.status;
      return (
        status === FileUploadStatus.NOT_STARTED ||
        status === FileUploadStatus.UPLOADING
      );
    });
    if (!pending) {
      actions.setApplyToAllAction(null);
    }
  }, [applyToAllAction, fileIds, fileMap, applyResolution, actions]);

  // The first file awaiting a conflict decision drives the prompt UI.
  const conflictFile = useMemo(() => {
    const id = fileIds.find(
      (fid) => fileMap[fid]?.status === FileUploadStatus.AWAITING_CONFLICT,
    );
    return id ? fileMap[id] : null;
  }, [fileIds, fileMap]);

  const awaitingCount = useMemo(
    () =>
      fileIds.filter(
        (id) => fileMap[id]?.status === FileUploadStatus.AWAITING_CONFLICT,
      ).length,
    [fileIds, fileMap],
  );

  const [applyToAllChecked, setApplyToAllChecked] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <input
        className="opacity-0 size-0"
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
      />
      <input
        className="opacity-0 size-0"
        ref={folderInputRef}
        type="file"
        {...({ webkitdirectory: "" } as any)}
        onChange={handleFolderChange}
      />
      {fileIds.length > 0 && (
        <div className="relative w-96 shadow-2xl rounded-xl overflow-hidden bg-surface-container-high border border-outline-variant/10">
          <div
            className={clsx(
              "transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
              collapse ? "translate-y-0" : "translate-y-0",
            )}
          >
            <div
              className={clsx(
                "relative overflow-hidden transition-colors duration-300",
                collapse
                  ? "bg-surface-container-high"
                  : "bg-surface-container-highest",
              )}
            >
              <div className="h-[3px] w-full bg-primary/10 relative overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500 ease-[cubic-bezier(0.2,0,0,1)]"
                  style={{ width: `${uploadSummary.totalProgress}%` }}
                />
              </div>
              <div className="flex items-center px-4 py-2.5 justify-between">
                <div className="flex flex-1 items-center gap-3">
                  <span className="text-label-large text-on-surface">
                    {uploadSummary.totalProgress === 100
                      ? "Upload complete"
                      : "Uploading..."}
                  </span>
                  {uploadSummary.totalSize > 0 && (
                    <span className="text-label-medium text-on-surface-variant">
                      {filesize(uploadSummary.uploadedSize)} of{" "}
                      {filesize(uploadSummary.totalSize)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="text"
                    className="text-on-surface-variant size-8 min-w-8 p-0"
                    isIconOnly
                    onPress={actions.toggleCollapse}
                  >
                    <IconParkOutlineDownC
                      className={clsx(
                        "size-5 transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                        collapse ? "rotate-180" : "rotate-0",
                      )}
                    />
                  </Button>
                  <Button
                    variant="text"
                    className="text-on-surface-variant size-8 min-w-8 p-0"
                    isIconOnly
                    onPress={actions.cancelUpload}
                  >
                    <IconParkOutlineCloseOne className="size-5" />
                  </Button>
                </div>
              </div>
            </div>
            <div
              className={clsx(
                "bg-surface-container-low overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                collapse
                  ? "opacity-0 scale-95 pointer-events-none h-0"
                  : "opacity-100 scale-100 pointer-events-auto max-h-96 overflow-y-auto",
                "scrollbar-thin scrollbar-thumb-outline-variant scrollbar-track-transparent",
              )}
            >
              <div className="px-2 py-2">
                <Listbox
                  aria-label="Upload Files"
                  isVirtualized={fileIds.length > 100}
                  className="select-none gap-1"
                >
                  {topLevelFileIds.map((id) => (
                    <ListboxItem
                      className="data-[hover=true]:bg-transparent px-0"
                      key={id}
                      textValue={id}
                    >
                      <UploadFileEntry
                        id={id}
                        chunkSize={Number(settings.splitFileSize)}
                        fileIds={fileIds}
                      />
                    </ListboxItem>
                  ))}
                </Listbox>
              </div>
            </div>
          </div>
          {conflictFile && !applyToAllAction && (
            <UploadConflictPrompt
              fileName={conflictFile.file.name}
              awaitingCount={awaitingCount}
              applyToAll={applyToAllChecked}
              onApplyToAllChange={setApplyToAllChecked}
              onResolve={(action) => {
                handleResolveConflict(conflictFile.id, action, applyToAllChecked);
                setApplyToAllChecked(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};
