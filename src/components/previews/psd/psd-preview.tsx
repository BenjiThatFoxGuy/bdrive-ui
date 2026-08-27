import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "@tw-material/react";
import clsx from "clsx";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import IconErrorOutline from "~icons/material-symbols/error-outline";
import IconLayers from "~icons/material-symbols/layers";
import IconLayersClear from "~icons/material-symbols/layers-clear";

import { center } from "@/utils/classes";
import fetchThrow from "@/utils/fetch-throw";
import {
  assertPsdHeader,
  formatBytes,
  layersVerdict,
  psdBudget,
  PsdError,
  type PsdImage,
  type PsdLayerNode,
} from "@/utils/psd";
import { closePsdImages, createPsdSession, type PsdSession } from "@/utils/psd-client";
import PsdCanvas from "./psd-canvas";
import PsdLayersPanel from "./psd-layers-panel";

function PsdPreview({ assetUrl, size }: PsdPreviewProps) {
  const budget = useMemo(psdBudget, []);
  const sessionRef = useRef<PsdSession>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [layerImages, setLayerImages] = useState<Record<string, CanvasImageSource>>();
  const [layersError, setLayersError] = useState("");
  const [isLoadingLayers, setIsLoadingLayers] = useState(false);

  // Checked before anything is requested: FileData.size is already in the modal, so a
  // file that can't be previewed never costs a byte of transfer. A size of 0 means the
  // listing didn't carry one, in which case the Content-Length check below is the gate.
  const isOverSizeCap = size > budget.maxPreviewBytes;

  const {
    data: parsed,
    error,
    isPending,
  } = useQuery({
    queryKey: ["psd", assetUrl],
    enabled: !isOverSizeCap,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      const response = await fetchThrow(assetUrl, { signal });

      // Belt and braces for stale metadata on shared links and rclone-proxy URLs.
      const declared = Number(response.headers.get("content-length"));
      if (declared > budget.maxPreviewBytes) throw new PsdError("too-large", TOO_LARGE_MESSAGE);

      const buffer = await response.arrayBuffer();

      // 26 bytes is enough to reject a non-PSD, a .psb or an unrenderable canvas
      // without spending a worker on it.
      assertPsdHeader(buffer, budget);

      const session = createPsdSession();
      sessionRef.current = session;

      const result = await session.composite({
        buffer,
        // Only hold the bytes for a second pass when layers are actually on the
        // table; otherwise the worker frees them the moment parsing returns.
        retain: size <= budget.maxPreviewBytes,
        maxDocPixels: budget.maxDocPixels,
        signal,
      });

      if (!result.composite && !layersVerdict({ ...result, budget }).available)
        throw new PsdError("no-composite", NO_COMPOSITE_MESSAGE);

      return result;
    },
  });

  const verdict = useMemo(
    () => (parsed ? layersVerdict({ ...parsed, budget }) : undefined),
    [parsed, budget],
  );

  const doc = useMemo(
    () => (parsed ? { width: parsed.width, height: parsed.height, tree: parsed.tree } : undefined),
    [parsed],
  );

  const composite = useMemo(
    () => (parsed?.composite ? toCanvasSource(parsed.composite) : undefined),
    [parsed],
  );

  // Seeded from each layer's own hidden flag, so the first render matches how the file
  // was last saved.
  useEffect(() => {
    if (parsed) setVisible(seedVisibility(parsed.tree));
  }, [parsed]);

  const loadLayers = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || layerImages || isLoadingLayers) return;

    setIsLoadingLayers(true);
    setLayersError("");

    try {
      const result = await session.layers({});
      setLayerImages(toCanvasSources(result.images));
    } catch {
      // A layers failure with a composite already on screen is local state, never a
      // thrown error - blanking a working preview would be the worse outcome.
      setLayersError(LAYERS_FAILED_MESSAGE);
      setPanelOpen(false);
    } finally {
      setIsLoadingLayers(false);
    }
  }, [layerImages, isLoadingLayers]);

  // A file with no usable merged image (written by a non-Photoshop tool, or in a
  // colour mode ag-psd won't convert) has to be rebuilt from layers to show anything
  // at all, so that runs without waiting for a gesture. The retained buffer makes it
  // free of extra I/O.
  useEffect(() => {
    if (parsed && !parsed.composite && verdict?.available) loadLayers();
  }, [parsed, verdict, loadLayers]);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    loadLayers();
  }, [loadLayers]);

  const onToggle = useCallback((id: string) => {
    setVisible((current) => ({ ...current, [id]: current[id] === false }));
  }, []);

  const onReset = useCallback(() => {
    if (parsed) setVisible(seedVisibility(parsed.tree));
  }, [parsed]);

  useEffect(
    () => () => {
      sessionRef.current?.dispose();
      sessionRef.current = undefined;
    },
    [],
  );

  if (isOverSizeCap)
    return <PsdMessage message={`${TOO_LARGE_MESSAGE} Download it to open it locally.`} />;

  if (isPending) return <Spinner className={center} />;

  if (error)
    return (
      <PsdMessage
        message={
          error instanceof PsdError ? error.message : "This Photoshop file couldn't be loaded."
        }
      />
    );

  if (!doc) return <PsdMessage message="This Photoshop file couldn't be loaded." />;

  return (
    <div className="relative flex size-full overflow-hidden">
      <div className="relative min-w-0 grow">
        <PsdCanvas
          doc={doc}
          composite={composite}
          images={layerImages}
          visible={layerImages ? visible : undefined}
          maxDim={budget.renderMaxDim}
        />

        <div className="absolute right-4 bottom-2 z-20 flex flex-col items-end gap-2">
          {(layersError || (verdict && !verdict.available)) && (
            <p className="max-w-xs rounded-medium bg-surface-container px-3 py-1.5 text-right text-body-small text-on-surface-variant shadow-1">
              {layersError || verdict?.reason}
            </p>
          )}
          <Button
            isIconOnly
            variant="filled"
            aria-label={panelOpen ? "Hide layers" : "Show layers"}
            isDisabled={!verdict?.available}
            onPress={panelOpen ? () => setPanelOpen(false) : openPanel}
          >
            {panelOpen ? (
              <IconLayersClear className="pointer-events-none" />
            ) : (
              <IconLayers className="pointer-events-none" />
            )}
          </Button>
        </div>
      </div>

      {panelOpen && doc.tree.length > 0 && (
        <div
          className={clsx(
            // Sidebar from md up; a bottom sheet below it, overlaying the canvas
            // rather than squeezing it out of existence on a phone.
            "absolute inset-x-0 bottom-0 z-30 max-h-[55%] overflow-hidden rounded-t-large shadow-3",
            "md:static md:inset-auto md:max-h-none md:w-72 md:shrink-0 md:rounded-none md:shadow-none",
            "md:border-outline-variant md:border-l",
          )}
        >
          <PsdLayersPanel
            tree={doc.tree}
            visible={visible}
            unsupportedBlends={parsed?.unsupportedBlends ?? []}
            isLoading={isLoadingLayers}
            onToggle={onToggle}
            onReset={onReset}
            onClose={() => setPanelOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

function PsdMessage({ message }: { message: string }) {
  return (
    <div className={clsx(center, "flex max-w-sm flex-col items-center gap-3 text-center")}>
      <IconErrorOutline className="size-8 text-error" />
      <p className="text-body-medium">{message}</p>
    </div>
  );
}

function seedVisibility(nodes: PsdLayerNode[], into: Record<string, boolean> = {}) {
  for (const node of nodes) {
    into[node.id] = !node.hidden;
    if (node.children) seedVisibility(node.children, into);
  }
  return into;
}

function toCanvasSource(image: PsdImage): CanvasImageSource {
  if (image.type === "bitmap") return image.bitmap;

  // No createImageBitmap in this browser: put the raw pixels into a canvas once and
  // use that as the draw source from then on.
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas;
}

function toCanvasSources(images: Record<string, PsdImage>) {
  const sources: Record<string, CanvasImageSource> = {};
  for (const [id, image] of Object.entries(images)) sources[id] = toCanvasSource(image);
  return sources;
}

const TOO_LARGE_MESSAGE = "This Photoshop file is too large to preview in the browser.";

const NO_COMPOSITE_MESSAGE =
  "This file has no flattened preview, and it's too large to rebuild from its layers.";

const LAYERS_FAILED_MESSAGE = "Layer data couldn't be read; showing the flattened preview.";

interface PsdPreviewProps {
  assetUrl: string;
  size: number;
}

export default memo(PsdPreview);
