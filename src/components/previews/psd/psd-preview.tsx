import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "@tw-material/react";
import clsx from "clsx";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import IconErrorOutline from "~icons/material-symbols/error-outline";
import IconLayers from "~icons/material-symbols/layers";
import IconLayersClear from "~icons/material-symbols/layers-clear";

import { fetchClient } from "@/utils/api";
import type { components } from "@/lib/api";
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
import { needsServerBlend } from "@/utils/psd-renderer-routing";
import PsdCanvas from "./psd-canvas";
import PsdLayersPanel from "./psd-layers-panel";

function PsdPreview({ assetUrl, size, fileId }: PsdPreviewProps) {
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

  // A PSD can fit the browser budget but still need the server's blend operators.
  const needsBlendOffload = useMemo(() => parsed ? needsServerBlend(parsed.tree) : false, [parsed]);
  const preferServer = !!fileId && !!parsed?.layerCount &&
    (verdict?.available === false || needsBlendOffload);
  const { data: serverMeta, isFetching: loadingServerMeta, isError: serverMetaError } = useQuery({
    queryKey: ["psd-preview-metadata", fileId, assetUrl],
    enabled: preferServer && panelOpen,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, response } = await fetchClient.GET("/files/{id}/psd-preview", {
        params: { path: { id: fileId! } }, signal,
      });
      if (!data || !response.ok) throw new Error("Layer metadata is unavailable");
      return data;
    },
  });
  const canFallBack = verdict?.available === true;
  const useServer = preferServer && !(serverMetaError && canFallBack);
  const blendApproximation = panelOpen && !useServer && needsBlendOffload && !parsed?.unsupportedBlends.length;
  useEffect(() => {
    if (panelOpen && serverMetaError && canFallBack) loadLayers();
  }, [panelOpen, serverMetaError, canFallBack, loadLayers]);
  const serverTree = useMemo(() => serverMeta?.layers.map(serverLayer), [serverMeta]);
  const [serverOverrides, setServerOverrides] = useState<Record<string, boolean>>({});
  const [rendered, setRendered] = useState<HTMLImageElement>();
  const [serverRenderError, setServerRenderError] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  // Pre-render cache: keyed by JSON-serialised single-layer overrides.
  // Populated in the background so the first toggle of a leaf layer is instant.
  const prerenderCache = useRef(new Map<string, HTMLImageElement>());
  const prerenderAbort = useRef<AbortController>();

  useEffect(() => {
    if (!fileId || !useServer || !serverMeta || !panelOpen) return;
    prerenderAbort.current?.abort();
    const controller = new AbortController();
    prerenderAbort.current = controller;
    const { signal } = controller;

    const leaves: { id: number; visible: boolean }[] = [];
    const walk = (layers: typeof serverMeta.layers) => {
      for (const l of layers) {
        if (l.children?.length) { walk(l.children); continue; }
        leaves.push({ id: l.id, visible: l.visible });
      }
    };
    walk(serverMeta.layers);
    // Cap at 24 to avoid hammering the server on huge files.
    const batch = leaves.slice(0, 24);

    (async () => {
      for (const layer of batch) {
        if (signal.aborted) break;
        const key = JSON.stringify({ [String(layer.id)]: !layer.visible });
        if (prerenderCache.current.has(key)) continue;
        try {
          const { data, response } = await fetchClient.POST("/files/{id}/psd-preview", {
            params: { path: { id: fileId } },
            body: { visibility: [{ id: layer.id, visible: !layer.visible }] },
            parseAs: "blob", signal,
          });
          if (!data || !response.ok || signal.aborted) continue;
          const img = new Image();
          const url = URL.createObjectURL(data);
          try { img.src = url; await img.decode(); if (!signal.aborted) prerenderCache.current.set(key, img); }
          finally { URL.revokeObjectURL(url); }
        } catch { /* network/cancel, skip */ }
      }
    })();

    return () => controller.abort();
  }, [fileId, useServer, serverMeta, panelOpen]);

  useEffect(() => {
    if (!fileId || !useServer || !serverMeta || !Object.keys(serverOverrides).length) {
      setRendered(undefined);
      setIsRendering(false);
      setServerRenderError(false);
      return;
    }
    // Check pre-render cache for instant hit
    const cacheKey = JSON.stringify(serverOverrides);
    const cached = prerenderCache.current.get(cacheKey);
    if (cached) {
      setRendered(cached);
      setIsRendering(false);
      setServerRenderError(false);
      return;
    }
    // Cancel pre-renders so the interactive request gets the slot
    prerenderAbort.current?.abort();
    const controller = new AbortController();
    const signal = controller.signal;
    setIsRendering(true);
    setServerRenderError(false);
    const timer = window.setTimeout(async () => {
      try {
        const { data, response } = await fetchClient.POST("/files/{id}/psd-preview", {
          params: { path: { id: fileId } },
          body: { visibility: Object.entries(serverOverrides).map(([id, visible]) => ({ id: Number(id), visible })) },
          parseAs: "blob", signal,
        });
        if (!data || !response.ok || data.type !== "image/png") throw new Error("Invalid preview image");
        const image = new Image();
        const url = URL.createObjectURL(data);
        try {
          image.src = url;
          await image.decode();
          if (!signal.aborted) setRendered(image);
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch {
        if (!signal.aborted) setServerRenderError(true);
      } finally {
        if (!signal.aborted) setIsRendering(false);
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fileId, serverMeta, serverOverrides, useServer]);
  const serverVisibility = useMemo(() => ({ ...seedVisibility(serverTree ?? []), ...serverOverrides }), [serverTree, serverOverrides]);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    if (!useServer) loadLayers();
  }, [loadLayers, useServer]);

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
          composite={rendered ?? composite}
          images={rendered ? undefined : layerImages}
          visible={!rendered && layerImages ? visible : undefined}
          maxDim={budget.renderMaxDim}
        />

        <div className="absolute right-4 bottom-2 z-20 flex flex-col items-end gap-2">
          {(layersError || serverMetaError || serverRenderError || (panelOpen && blendApproximation) || (!useServer && verdict && !verdict.available)) && (
            <p className="max-w-xs rounded-medium bg-surface-container px-3 py-1.5 text-right text-body-small text-on-surface-variant shadow-1">
              {layersError || (serverMetaError ? "The server cannot inspect layers for this file." : serverRenderError ? "The server could not render these layers. The last available preview is still shown." : blendApproximation ? "Some blending is approximated in the browser. Toggle layers to see server-rendered output." : verdict?.reason)}
            </p>
          )}
          <Button
            isIconOnly
            variant="filled"
            aria-label={panelOpen ? "Hide layers" : "Show layers"}
            isDisabled={!verdict?.available && !useServer}
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

      {panelOpen && (useServer || doc.tree.length > 0) && (
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
            tree={useServer ? serverTree ?? [] : doc.tree.toReversed()}
            visible={useServer ? serverVisibility : visible}
            unsupportedBlends={useServer ? [] : parsed?.unsupportedBlends ?? []}
            isLoading={useServer ? loadingServerMeta : isLoadingLayers}
            onToggle={useServer ? (id) => setServerOverrides((current) => ({ ...current, [id]: !(current[id] ?? serverVisibility[id]) })) : onToggle}
            onReset={useServer ? () => setServerOverrides({}) : onReset}
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

function serverLayer(layer: components["schemas"]["PsdPreviewLayer"]): PsdLayerNode {
  return {
    id: String(layer.id), name: layer.name, kind: layer.group ? "group" : "layer",
    hidden: !layer.visible, opacity: 1, blendMode: "normal", blendSupported: true,
    left: 0, top: 0, width: 0, height: 0, clipping: false,
    children: layer.children?.map(serverLayer),
  };
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
  fileId?: string;
  size: number;
}

export default memo(PsdPreview);
