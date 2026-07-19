import { memo, useCallback, useEffect, useState } from "react";
import { FbActions } from "@tw-material/file-browser";
import {
  Button,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
} from "@tw-material/react";
import { useShallow } from "zustand/react/shallow";

import { useModalStore, useSettingsStore } from "@/utils/stores";
import { Controller, useForm } from "react-hook-form";
import { CustomActions } from "@/hooks/use-file-action";
import { CopyButton } from "@/components/copy-button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import IcRoundClose from "~icons/ic/round-close";
import { filesize, getNextDate } from "@/utils/common";
import ShowPasswordIcon from "~icons/mdi/eye-outline";
import HidePasswordIcon from "~icons/mdi/eye-off-outline";
import MdiProtectedOutline from "~icons/mdi/protected-outline";
import { $api } from "@/utils/api";
import { useNavigate, useSearch } from "@tanstack/react-router";

type FileModalProps = {
  queryKey: any;
};

interface RenameDialogProps {
  queryKey: any;
  handleClose: () => void;
}

const RenameDialog = memo(({ queryKey, handleClose }: RenameDialogProps) => {
  const queryClient = useQueryClient();
  const updateFiles = $api.useMutation("patch", "/files/{id}", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const { currentFile, actions } = useModalStore(
    useShallow((state) => ({
      currentFile: state.currentFile,
      actions: state.actions,
    })),
  );

  const onRename = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      e.preventDefault();
      updateFiles
        .mutateAsync({
          params: {
            path: {
              id: currentFile.id,
            },
          },
          body: {
            name: currentFile?.name,
          },
        })
        .then(handleClose);
    },
    [currentFile.name, currentFile.id],
  );

  return (
    <>
      <ModalHeader className="flex flex-col gap-1">Rename</ModalHeader>
      <ModalBody as="form" id="rename-form" onSubmit={onRename}>
        <Input
          size="lg"
          variant="bordered"
          classNames={{
            inputWrapper: "border-primary border-large",
          }}
          autoFocus
          value={currentFile.name}
          onValueChange={(value) => actions.setCurrentFile({ ...currentFile, name: value })}
        />
      </ModalBody>
      <ModalFooter>
        <Button className="font-normal" variant="text" onPress={handleClose}>
          Close
        </Button>
        <Button
          type="submit"
          className="font-normal"
          variant="filledTonal"
          form="rename-form"
          isDisabled={updateFiles.isPending || !currentFile.name}
          isLoading={updateFiles.isPending}
        >
          Rename
        </Button>
      </ModalFooter>
    </>
  );
});

interface FolderCreateDialogProps {
  queryKey: any;
  handleClose: () => void;
}

const FolderCreateDialog = memo(({ queryKey, handleClose }: FolderCreateDialogProps) => {
  const queryClient = useQueryClient();

  const { path } = useSearch({ from: "/_authed/$view" });

  const createFolder = $api.useMutation("post", "/files", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const { currentFile, actions } = useModalStore(
    useShallow((state) => ({
      currentFile: state.currentFile,
      actions: state.actions,
    })),
  );

  const onCreate = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      e.preventDefault();
      createFolder
        .mutateAsync({
          body: {
            name: currentFile.name,
            type: "folder",
            path: path ? path : "/",
          },
        })
        .then(() => handleClose());
    },
    [currentFile.name],
  );

  return (
    <>
      <ModalHeader className="flex flex-col gap-1">Create Folder</ModalHeader>
      <ModalBody as="form" id="create-folder-form" onSubmit={onCreate}>
        <Input
          size="lg"
          variant="bordered"
          classNames={{
            inputWrapper: "border-primary border-large",
          }}
          placeholder="Folder Name or Path"
          autoFocus
          value={currentFile?.name}
          onValueChange={(value) => actions.setCurrentFile({ ...currentFile, name: value })}
        />
      </ModalBody>
      <ModalFooter>
        <Button className="font-normal" variant="text" onPress={handleClose}>
          Close
        </Button>
        <Button
          type="submit"
          form="create-folder-form"
          className="font-normal"
          variant="filledTonal"
          isDisabled={createFolder.isPending || !currentFile.name}
          isLoading={createFolder.isPending}
        >
          {createFolder.isPending ? "Creating" : "Create"}
        </Button>
      </ModalFooter>
    </>
  );
});

interface DeleteDialogProps {
  queryKey: any;
  handleClose: () => void;
}

const DeleteDialog = memo(({ handleClose, queryKey }: DeleteDialogProps) => {
  const queryClient = useQueryClient();

  const deleteFiles = $api.useMutation("post", "/files/delete", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const selectedFiles = useModalStore((state) => state.selectedFiles) as string[];

  const onDelete = useCallback(() => {
    deleteFiles.mutateAsync({ body: { ids: selectedFiles } });
    handleClose();
  }, [selectedFiles]);

  return (
    <>
      <ModalHeader className="flex flex-col gap-1">Delete Files</ModalHeader>
      <ModalBody>
        <h1 className="text-large font-medium mt-2">
          {`Are you sure to delete ${selectedFiles.length} file${
            selectedFiles.length > 1 ? "s" : ""
          } ?`}
        </h1>
      </ModalBody>
      <ModalFooter>
        <Button className="font-normal" variant="text" onPress={handleClose}>
          No
        </Button>
        <Button
          variant="filledTonal"
          classNames={{
            base: "font-normal",
          }}
          onPress={onDelete}
        >
          Yes
        </Button>
      </ModalFooter>
    </>
  );
});

interface ShareFileDialogProps {
  handleClose: () => void;
}

const defaultShareOptions = {
  expirationDate: "",
  password: "",
};

const ShareFileDialog = memo(({ handleClose }: ShareFileDialogProps) => {
  const file = useModalStore((state) => state.currentFile);

  const queryClient = useQueryClient();

  const { control, handleSubmit } = useForm({
    defaultValues: defaultShareOptions,
  });

  const shareQueryOptions = $api.queryOptions("get", "/files/{id}/share", {
    params: {
      path: {
        id: file.id,
      },
    },
  });

  const { data, isLoading } = useQuery(shareQueryOptions);

  const createShare = $api.useMutation("post", "/files/{id}/share", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shareQueryOptions.queryKey });
      queryClient.invalidateQueries({ queryKey: ["Files_list", "shared"] });
    },
  });

  const deleteShare = $api.useMutation("delete", "/files/{id}/share", {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Files_list", "shared"] });
    },
  });

  const [sharingOn, setSharingOn] = useState(false);

  const [shareLink, setShareLink] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const onShareChange = useCallback(() => {
    setSharingOn((prev) => {
      if (!prev) {
        handleSubmit((data) => {
          const payload = {} as Record<string, string>;
          if (data.expirationDate) {
            payload.expirationDate = `${data.expirationDate}${new Date().toISOString().slice(10)}`;
          }
          if (data.password) {
            payload.password = data.password;
          }
          createShare.mutateAsync({
            params: {
              path: {
                id: file.id,
              },
            },
            body: payload,
          });
        })();
      }
      if (prev) {
        deleteShare.mutateAsync({
          params: {
            path: {
              id: file.id,
            },
          },
        });
        setShareLink("");
      }
      return !prev;
    });
  }, []);

  useEffect(() => {
    if (data) {
      setSharingOn(true);
      setShareLink(`${window.location.origin}/share/${data.id}`);
    }
  }, [data]);

  return (
    <>
      <ModalHeader className="flex items-center justify-between ">
        Share Files
        <Button size="sm" variant="text" isIconOnly onPress={handleClose}>
          <IcRoundClose />
        </Button>
      </ModalHeader>
      <ModalBody>
        <form className="grid grid-cols-6 gap-8 p-2 w-full overflow-y-auto">
          <div className="col-span-6 xs:col-span-3">
            <p className="text-lg font-medium">Set expiration date</p>
            <p className="text-sm font-normal text-on-surface-variant">Link expiration date</p>
          </div>
          <Controller
            name="expirationDate"
            control={control}
            render={({ field, fieldState: { error } }) => (
              <Input
                size="lg"
                className="col-span-6 xs:col-span-3"
                variant="bordered"
                isInvalid={!!error}
                errorMessage={error?.message}
                type="date"
                min={getNextDate()}
                {...field}
              />
            )}
          />
          <div className="col-span-6 xs:col-span-3">
            <p className="text-lg font-medium">Set link password</p>
            <p className="text-sm font-normal text-on-surface-variant">Public link password</p>
          </div>
          <Controller
            name="password"
            control={control}
            render={({ field, fieldState: { error } }) => (
              <Input
                size="lg"
                className="col-span-6 xs:col-span-3"
                variant="bordered"
                autoComplete="off"
                isInvalid={!!error}
                errorMessage={error?.message}
                type={showPassword ? "text" : "password"}
                {...field}
                endContent={
                  <Button
                    isIconOnly
                    className="size-8 min-w-8"
                    variant="text"
                    onPress={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <HidePasswordIcon /> : <ShowPasswordIcon />}
                  </Button>
                }
              />
            )}
          />
        </form>
        <Divider />
        <div className="flex justify-between">
          <h1 className="text-large font-medium mt-2">Sharing {sharingOn ? "On" : "Off"}</h1>
          <div className="flex items-center gap-3">
            {data?.protected && <MdiProtectedOutline className="text-primary" />}

            <Switch size="md" isSelected={sharingOn} onChange={onShareChange} />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Input
          isDisabled={isLoading || !data}
          fullWidth
          variant="bordered"
          readOnly
          value={shareLink}
        />
        <CopyButton value={shareLink} isDisabled={isLoading || !data} />
      </ModalFooter>
    </>
  );
});

const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between items-center py-2 border-b border-outline-variant/30 last:border-0 gap-4">
    <span className="text-sm font-medium text-on-surface-variant">{label}</span>
    <span className="text-base font-semibold text-right break-all">{value}</span>
  </div>
);

interface FileInfoDialogProps {
  handleClose: () => void;
}

const FileInfoDialog = memo(({ handleClose }: FileInfoDialogProps) => {
  const currentFile = useModalStore((state) => state.currentFile);
  const navigate = useNavigate();
  const { settings } = useSettingsStore();
  const usePathNav = settings.usePathNavigation ?? true;

  const { data: canonicalFile } = $api.useQuery(
    "get",
    "/files/{id}",
    { params: { path: { id: currentFile.referencedFileId as string } } },
    { enabled: !!currentFile.referencedFileId },
  );

  const { data: duplicates } = $api.useQuery(
    "get",
    "/files/{id}/duplicates",
    { params: { path: { id: currentFile.id } } },
    { enabled: !!currentFile.hash },
  );

  const goToFile = useCallback(
    (file: { id?: string; path?: string }) => {
      if (!file.id) return;
      if (usePathNav && file.path) {
        let p = file.path;
        if (p.endsWith("/")) p = p.slice(0, -1);
        const lastSlash = p.lastIndexOf("/");
        let parentPath = lastSlash >= 0 ? p.slice(0, lastSlash) : "";
        if (parentPath === "") parentPath = "/";
        if (!parentPath.startsWith("/")) parentPath = `/${parentPath}`;
        navigate({
          to: "/$view",
          params: { view: "my-drive" },
          search: { path: parentPath, selectId: file.id },
        });
      } else {
        navigate({
          to: "/$view",
          params: { view: "my-drive" },
          search: { selectId: file.id },
        });
      }
      handleClose();
    },
    [usePathNav, navigate, handleClose],
  );

  const goToCanonicalFile = useCallback(() => {
    if (canonicalFile) goToFile(canonicalFile);
  }, [canonicalFile, goToFile]);

  return (
    <>
      <ModalHeader className="flex flex-col gap-1">File Info</ModalHeader>
      <ModalBody>
        <div className="flex flex-col">
          <InfoRow label="Name" value={currentFile.name} />
          <InfoRow label="Type" value={currentFile.mimeType || currentFile.type} />
          <InfoRow
            label="Size"
            value={currentFile.size ? filesize(currentFile.size) : "—"}
          />
          {currentFile.path && <InfoRow label="Path" value={currentFile.path} />}
          <InfoRow label="Encrypted" value={currentFile.isEncrypted ? "Yes" : "No"} />
          <InfoRow label="Starred" value={currentFile.starred ? "Yes" : "No"} />
          {currentFile.modDate && (
            <InfoRow label="Updated" value={new Date(currentFile.modDate).toLocaleString()} />
          )}
          {currentFile.hash && (
            <InfoRow
              label="Hash"
              value={<span className="font-mono text-xs">{currentFile.hash}</span>}
            />
          )}
          {currentFile.referencedFileId && (
            <InfoRow
              label="Shares storage with"
              value={
                canonicalFile ? (
                  <Button
                    size="sm"
                    variant="text"
                    className="font-normal"
                    onPress={goToCanonicalFile}
                  >
                    {canonicalFile.name}
                  </Button>
                ) : (
                  "Loading..."
                )
              }
            />
          )}
          {duplicates && duplicates.items.length > 0 && (
            <InfoRow
              label="Duplicates"
              value={
                <div className="flex flex-col items-end gap-1">
                  {duplicates.items.map((dup) => (
                    <Button
                      key={dup.id}
                      size="sm"
                      variant="text"
                      className="font-normal"
                      onPress={() => goToFile(dup)}
                    >
                      {dup.name}
                    </Button>
                  ))}
                </div>
              }
            />
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button className="font-normal" variant="text" onPress={handleClose}>
          Close
        </Button>
      </ModalFooter>
    </>
  );
});

export const FileOperationModal = memo(({ queryKey }: FileModalProps) => {
  const { open, operation, actions } = useModalStore(
    useShallow((state) => ({
      open: state.open,
      operation: state.operation,
      actions: state.actions,
    })),
  );

  const handleClose = useCallback(
    () =>
      actions.set({
        open: false,
      }),
    [],
  );

  const renderOperation = () => {
    switch (operation) {
      case FbActions.RenameFile.id:
        return <RenameDialog queryKey={queryKey} handleClose={handleClose} />;
      case FbActions.CreateFolder.id:
        return <FolderCreateDialog queryKey={queryKey} handleClose={handleClose} />;
      case FbActions.DeleteFiles.id:
        return <DeleteDialog queryKey={queryKey} handleClose={handleClose} />;
      case CustomActions.ShareFiles.id:
        return <ShareFileDialog handleClose={handleClose} />;
      case CustomActions.ShowFileInfo.id:
        return <FileInfoDialog handleClose={handleClose} />;
      default:
        return null;
    }
  };

  return (
    <Modal
      isOpen={open}
      size="md"
      classNames={{
        wrapper: "overflow-hidden",
        base: "bg-surface w-full shadow-none",
      }}
      placement="center"
      onClose={handleClose}
      hideCloseButton
    >
      <ModalContent>{renderOperation}</ModalContent>
    </Modal>
  );
});
