import { initializeCanvas, type Layer, type Psd, readPsd } from "ag-psd";

import {
  BLEND_MODES,
  type PsdCompositeResult,
  type PsdFailure,
  type PsdImage,
  type PsdLayerNode,
  type PsdLayersResult,
  type PsdRequest,
} from "./psd";

// The only module that imports ag-psd, so the parser (~140KB gzipped, and it can't
// tree-shake its writer half) lands in a worker chunk instead of any UI chunk.
//
// Everything here uses `useImageData: true` so ag-psd hands back ImageData rather than
// canvases. It still allocates those buffers through its own indirection, though, so
// it needs initializeCanvas either way - but the second argument lets that go straight
// to the ImageData constructor, which every worker has, instead of through a canvas.
// OffscreenCanvas (Safari 16.4+) is therefore only reachable via the JPEG-thumbnail
// path, which `skipThumbnail: true` never takes.

// DedicatedWorkerGlobalScope lives in lib.webworker, which can't be added alongside
// lib.dom, so declare the sliver of it this file actually uses.
initializeCanvas(
  (width, height) => {
    // Only ag-psd's JPEG-thumbnail path asks for a real canvas, and every read here
    // passes skipThumbnail, so reaching this on a browser without OffscreenCanvas
    // would be a bug rather than something to paper over.
    if (typeof OffscreenCanvas !== "function")
      throw new Error("canvas decoding is unavailable in this browser")
    return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement
  },
  (width, height) => new ImageData(width, height),
)

const ctx = self as unknown as WorkerScope;

// Pass 2 re-reads these bytes. Re-posting is impossible (pass 1 transfers the buffer
// in, detaching the caller's copy) and re-fetching would mean a second full download
// from Telegram, so the worker holds them - but only when the file is small enough
// for layers to be on the table at all.
let retainedBuffer: ArrayBuffer | undefined;

ctx.onmessage = async (event: MessageEvent<PsdRequest>) => {
  const request = event.data;

  try {
    if (request.kind === "composite") {
      await handleComposite(request.id, request.buffer, request.retain);
      return;
    }
    await handleLayers(request.id);
  } catch (error) {
    fail(request.id, error);
  }
};

async function handleComposite(id: number, buffer: ArrayBuffer, retain: boolean) {
  // Still walks the layer-and-mask-info section - it has to, to reach the merged
  // image - so layer metadata comes back for free without decompressing a single
  // layer channel. That metadata is what lets the gate, the tree and the blend-mode
  // note all be decided before any layer pixel is touched.
  const psd = readPsd(buffer, {
    skipLayerImageData: true,
    skipThumbnail: true,
    useImageData: true,
  });

  // Drop the bytes before allocating the composite bitmap so the two peaks never
  // overlap. Files too large for layers never keep them at all.
  retainedBuffer = retain ? buffer : undefined;

  const tree = buildTree(psd.children ?? [], "");
  const stats = { layerCount: 0, layerPixelBytes: 0, unsupportedBlends: new Set<string>() };
  collectStats(tree, stats);

  const transfer: Transferable[] = [];
  const composite = await toPsdImage(psd.imageData, transfer);

  const result: PsdCompositeResult = {
    id,
    kind: "composite",
    ok: true,
    width: psd.width,
    height: psd.height,
    composite,
    tree,
    layerCount: stats.layerCount,
    layerPixelBytes: stats.layerPixelBytes,
    retained: retainedBuffer !== undefined,
    unsupportedBlends: [...stats.unsupportedBlends],
  };

  ctx.postMessage(result, transfer);
}

async function handleLayers(id: number) {
  if (!retainedBuffer) throw new Error("layer data is no longer available");

  const psd = readPsd(retainedBuffer, {
    skipCompositeImageData: true,
    skipThumbnail: true,
    useImageData: true,
  });

  const transfer: Transferable[] = [];
  const images: Record<string, PsdImage> = {};
  await collectImages(psd.children ?? [], "", images, transfer);

  // Pass 2 runs once; the main thread caches the result, so nothing needs these
  // bytes again.
  retainedBuffer = undefined;

  const result: PsdLayersResult = { id, kind: "layers", ok: true, images };
  ctx.postMessage(result, transfer);
}

function buildTree(layers: Layer[], prefix: string): PsdLayerNode[] {
  return layers.map((layer, index) => {
    const id = prefix ? `${prefix}/${index}` : `${index}`;
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const blendMode = layer.blendMode ?? "normal";

    const node: PsdLayerNode = {
      id,
      name: layer.name?.trim() || "(unnamed)",
      kind: layer.children ? "group" : "layer",
      hidden: layer.hidden === true,
      // ag-psd normalises opacity to 0..1, which is already what globalAlpha wants.
      opacity: layer.opacity ?? 1,
      blendMode,
      blendSupported: blendMode in BLEND_MODES,
      left,
      top,
      width: Math.max(0, (layer.right ?? 0) - left),
      height: Math.max(0, (layer.bottom ?? 0) - top),
      clipping: layer.clipping === true,
    };

    if (layer.mask) {
      const maskLeft = layer.mask.left ?? 0;
      const maskTop = layer.mask.top ?? 0;
      node.mask = {
        left: maskLeft,
        top: maskTop,
        width: Math.max(0, (layer.mask.right ?? 0) - maskLeft),
        height: Math.max(0, (layer.mask.bottom ?? 0) - maskTop),
        disabled: layer.mask.disabled === true,
        // defaultColor 255 means everything outside the mask rect stays opaque.
        defaultOpaque: layer.mask.defaultColor === 255,
      };
    }

    if (layer.children) node.children = buildTree(layer.children, id);

    return node;
  });
}

function collectStats(nodes: PsdLayerNode[], stats: TreeStats) {
  for (const node of nodes) {
    if (!node.blendSupported) stats.unsupportedBlends.add(node.blendMode);

    if (node.children) {
      collectStats(node.children, stats);
      continue;
    }

    stats.layerCount += 1;
    stats.layerPixelBytes += node.width * node.height * 4;
  }
}

async function collectImages(
  layers: Layer[],
  prefix: string,
  images: Record<string, PsdImage>,
  transfer: Transferable[],
) {
  for (const [index, layer] of layers.entries()) {
    const id = prefix ? `${prefix}/${index}` : `${index}`;

    if (layer.children) {
      await collectImages(layer.children, id, images, transfer);
      continue;
    }

    const image = await toPsdImage(layer.imageData, transfer);
    if (image) images[id] = image;

    // ag-psd returns masks as opaque greyscale, so compositing one with
    // `destination-in` would be a no-op. Move the grey into alpha here, off the
    // main thread, and let the renderer treat it as a plain alpha stencil.
    if (layer.mask?.imageData && layer.mask.disabled !== true) {
      const mask = toClampedPixels(layer.mask.imageData);
      if (mask) {
        for (let i = 0; i < mask.data.length; i += 4) {
          mask.data[i + 3] = mask.data[i];
          mask.data[i] = 0;
          mask.data[i + 1] = 0;
          mask.data[i + 2] = 0;
        }
        const maskImage = await toPsdImage(mask, transfer);
        if (maskImage) images[`${id}:mask`] = maskImage;
      }
    }
  }
}

// Normalises ag-psd's PixelData into something ImageData accepts. 16- and 32-bit
// documents come back as Uint16Array/Float32Array; those aren't convertible here, so
// the layer is skipped rather than rendered wrong.
function toClampedPixels(pixels: PixelDataLike | undefined): ClampedPixels | undefined {
  if (!pixels || !pixels.width || !pixels.height) return undefined;

  const { data } = pixels;

  // ag-psd allocates its own plain ArrayBuffers, so the SharedArrayBuffer arm of
  // ArrayBufferLike that TS 5.7+ tracks can't occur here.
  if (data instanceof Uint8ClampedArray)
    return {
      data: data as Uint8ClampedArray<ArrayBuffer>,
      width: pixels.width,
      height: pixels.height,
    };

  if (data instanceof Uint8Array)
    return {
      data: Uint8ClampedArray.from(data),
      width: pixels.width,
      height: pixels.height,
    };

  return undefined;
}

async function toPsdImage(
  pixels: PixelDataLike | undefined,
  transfer: Transferable[],
): Promise<PsdImage | undefined> {
  const normalized = toClampedPixels(pixels);
  if (!normalized) return undefined;

  const { data, width, height } = normalized;

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(new ImageData(data, width, height));
    transfer.push(bitmap);
    return { type: "bitmap", bitmap };
  }

  // No createImageBitmap: hand over the raw buffer instead, still zero-copy. The
  // renderer puts it into a scratch canvas once and uses that as a draw source.
  transfer.push(data.buffer);
  return { type: "raw", width, height, data };
}

function fail(id: number, error: unknown) {
  const isMemory = error instanceof RangeError || /allocat|memory/i.test(String(error));

  const failure: PsdFailure = {
    id,
    ok: false,
    code: isMemory ? "worker" : "decode",
    message: isMemory
      ? "The browser ran out of memory opening this Photoshop file."
      : "This Photoshop file couldn't be read.",
  };

  ctx.postMessage(failure);
}

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

interface ClampedPixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

interface TreeStats {
  layerCount: number;
  layerPixelBytes: number;
  unsupportedBlends: Set<string>;
}

type PixelDataLike = NonNullable<Psd["imageData"]>;
