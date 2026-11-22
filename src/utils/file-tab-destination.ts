import type { FileListParams, ShareListParams } from "@/types";
import type { FileData } from "@tw-material/file-browser";

export function canOpenInNewTab(file: FileData | null): file is FileData {
  return !!file && (file.isDir === true || !!file.isZip || file.openable !== false);
}

export function fileTabDestination(
  context: FileListParams | ShareListParams,
  file: FileData,
) {
  if (!canOpenInNewTab(file)) return;
  const archive = file.isZip
    ? { zipId: file.id, zipPath: "/", archiveType: file.name.split(".").pop()?.toLowerCase() ?? "zip" }
    : undefined;
  const childPath = (base?: string) => file.chain ? file.path : `${(base ?? "").replace(/\/$/, "")}/${file.name}`;

  if ("id" in context) {
    return {
      to: "/share/$id" as const,
      params: { id: context.id },
      search: archive ?? (file.isDir ? { path: childPath(context.path) } : { path: context.path || undefined, previewId: file.id }),
    };
  }

  const { view, params } = context;
  const { selectId, previewId, ...listing } = params;
  if (archive) return { to: "/$view" as const, params: { view: "browse" }, search: archive };
  if (file.isDir) {
    if (params.zipId) {
      return { to: "/$view" as const, params: { view: "browse" }, search: { zipId: params.zipId, archiveType: params.archiveType, zipPath: file.path } };
    }
    return view === "my-drive"
      ? { to: "/$view" as const, params: { view }, search: { path: childPath(params.path) } }
      : { to: "/$view" as const, params: { view: "browse" }, search: { parentId: file.id } };
  }
  return { to: "/$view" as const, params: { view }, search: { ...listing, previewId: file.id } };
}
