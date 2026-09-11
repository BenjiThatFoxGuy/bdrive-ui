// A .psd is a flat container: a 26-byte header, colour mode data, image resources,
// the layer-and-mask-info section, then a mandatory merged ("composite") image of the
// whole document. Photoshop composites layers with a much larger set of blend modes
// than Canvas 2D exposes, and applies effects (drop shadows, strokes, adjustment
// layers) this can't reproduce, so a rebuilt-from-layers render is an approximation
// and the UI says as much. Nothing here imports ag-psd - the parser lives in
// psd-worker.ts so it stays out of every UI chunk.

const PSD_SIGNATURE = 0x38425053; // "8BPS"

const PSD_HEADER_BYTES = 26;

// Above this the ArrayBuffer alone risks an allocation failure on mobile Safari
// before any decoding starts.
export const MAX_PREVIEW_BYTES = 256 * 1024 * 1024;

// The memory driver is the decoded composite, not the file size: ag-psd yields
// full-resolution RGBA and can't decode downscaled, so 64MP is already a 256MB
// ImageData. PSD's own maximum of 30000x30000 is unrenderable in a browser.
export const MAX_DOC_PIXELS = 64 * 1024 * 1024;

// Past this the panel is unusable and one composite pass crosses a frame budget.
export const MAX_LAYERS = 250;

// Sum of decoded layer bitmaps. This, not the compressed size, is what runs a tab
// out of memory: 40 full-canvas layers in a 30MB file cost more than 3 small ones
// in a 300MB file.
export const MAX_LAYER_PIXEL_BYTES = 192 * 1024 * 1024;

// Display surface cap, ~64MB per scratch canvas. No preview modal is wider than
// 2560 CSS px even at 2x DPR.
export const RENDER_MAX_DIM = 4096;

export function psdBudget(): PsdBudget {
  // deviceMemory is absent on Safari; treat unknown as roomy rather than punishing
  // every Safari user with the low-memory budget.
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  const constrained = typeof memory === "number" && memory <= 4;

  return {
    maxPreviewBytes: MAX_PREVIEW_BYTES,
    maxDocPixels: MAX_DOC_PIXELS,
    maxLayers: constrained ? MAX_LAYERS / 2 : MAX_LAYERS,
    maxLayerPixelBytes: constrained ? MAX_LAYER_PIXEL_BYTES / 2 : MAX_LAYER_PIXEL_BYTES,
    renderMaxDim: constrained ? 2048 : RENDER_MAX_DIM,
  };
}

// Reads the fixed-size header, which is enough to reject a file before spending a
// worker on it. Throws rather than returning a result so callers stay linear.
export function assertPsdHeader(buffer: ArrayBuffer, budget = psdBudget()): PsdHeader {
  if (buffer.byteLength < PSD_HEADER_BYTES)
    throw new PsdError("signature", "This file isn't a Photoshop document.");

  const view = new DataView(buffer);

  if (view.getUint32(0) !== PSD_SIGNATURE)
    throw new PsdError("signature", "This file isn't a Photoshop document.");

  const version = view.getUint16(4);

  if (version === 2)
    throw new PsdError(
      "psb",
      "This is a large-document Photoshop file (.psb), which isn't supported.",
    );

  if (version !== 1)
    throw new PsdError("version", "This Photoshop file uses an unsupported format version.");

  const height = view.getUint32(14);
  const width = view.getUint32(18);

  if (width * height > budget.maxDocPixels)
    throw new PsdError(
      "too-large-canvas",
      `This document is ${width}×${height} pixels — too large to render in the browser.`,
    );

  return {
    width,
    height,
    channels: view.getUint16(12),
    depth: view.getUint16(22),
    colorMode: view.getUint16(24),
  };
}

// Decides whether layer toggling is affordable, from exact pass-1 metadata rather
// than an estimate.
export function layersVerdict({ layerCount, layerPixelBytes, budget }: LayersVerdictArgs) {
  if (layerCount === 0) return { available: false, reason: "This file has no separate layers." };

  if (layerCount > budget.maxLayers)
    return {
      available: false,
      reason: `Layer editing is off for files with this many layers (${layerCount}).`,
    };

  if (layerPixelBytes > budget.maxLayerPixelBytes)
    return {
      available: false,
      reason: `Layer editing is off for files this large (${layerCount} layers, ${formatBytes(layerPixelBytes)} of layer data).`,
    };

  return { available: true, reason: "" };
}

export function isBlendSupported(mode: string) {
  return mode in BLEND_MODES;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export class PsdError extends Error {
  code: PsdErrorCode;

  constructor(code: PsdErrorCode, message: string) {
    super(message);
    this.name = "PsdError";
    this.code = code;
  }
}

// PSD blend mode -> Canvas 2D globalCompositeOperation. Anything absent here has no
// Canvas 2D equivalent and is drawn as Normal; the layers panel labels those layers.
// Unmapped: dissolve, linear burn, linear dodge, vivid light, linear light, pin light,
// hard mix, subtract, divide, darker color, and lighter color.
//
// "pass through" is here rather than unmapped on purpose. It's group-only, it's
// Photoshop's default for every new group, and treating it as unsupported would put a
// warning on essentially any layered file. Groups are always rendered isolated (see
// psd-composite.ts), which differs from true pass-through only when a layer inside the
// group blends against the backdrop below it - rare enough not to warn about.
export const BLEND_MODES: Record<string, GlobalCompositeOperation> = {
  normal: "source-over",
  darken: "darken",
  multiply: "multiply",
  "color burn": "color-burn",
  lighten: "lighten",
  screen: "screen",
  "color dodge": "color-dodge",
  overlay: "overlay",
  "soft light": "soft-light",
  "hard light": "hard-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  "pass through": "source-over",
};

export const PSD_ERROR_CODES = {
  signature: "signature",
  psb: "psb",
  version: "version",
  tooLarge: "too-large",
  tooLargeCanvas: "too-large-canvas",
  noComposite: "no-composite",
  worker: "worker",
  decode: "decode",
} as const;

export type PsdErrorCode = (typeof PSD_ERROR_CODES)[keyof typeof PSD_ERROR_CODES];

export interface PsdBudget {
  maxPreviewBytes: number;
  maxDocPixels: number;
  maxLayers: number;
  maxLayerPixelBytes: number;
  renderMaxDim: number;
}

export interface PsdHeader {
  width: number;
  height: number;
  channels: number;
  depth: number;
  colorMode: number;
}

export interface LayersVerdictArgs {
  layerCount: number;
  layerPixelBytes: number;
  budget: PsdBudget;
}

export interface PsdMaskInfo {
  left: number;
  top: number;
  width: number;
  height: number;
  disabled: boolean;
  defaultOpaque: boolean;
}

export interface PsdLayerNode {
  // Stable index path ("0/2/1"). ag-psd exposes no reliable per-layer id, and the
  // path survives re-parsing because the tree shape is identical between passes.
  id: string;
  name: string;
  kind: "layer" | "group";
  hidden: boolean;
  opacity: number;
  blendMode: string;
  blendSupported: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  clipping: boolean;
  mask?: PsdMaskInfo;
  children?: PsdLayerNode[];
}

export type PsdImage =
  | { type: "bitmap"; bitmap: ImageBitmap }
  // Pinned to ArrayBuffer rather than ArrayBufferLike so it can go straight into an
  // ImageData; the worker only ever produces plain buffers.
  | { type: "raw"; width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

export interface PsdCompositeRequest {
  id: number;
  kind: "composite";
  buffer: ArrayBuffer;
  retain: boolean;
  maxDocPixels: number;
}

export interface PsdLayersRequest {
  id: number;
  kind: "layers";
}

export type PsdRequest = PsdCompositeRequest | PsdLayersRequest;

export interface PsdCompositeResult {
  id: number;
  kind: "composite";
  ok: true;
  width: number;
  height: number;
  composite?: PsdImage;
  tree: PsdLayerNode[];
  layerCount: number;
  layerPixelBytes: number;
  retained: boolean;
  unsupportedBlends: string[];
}

export interface PsdLayersResult {
  id: number;
  kind: "layers";
  ok: true;
  images: Record<string, PsdImage>;
}

export interface PsdFailure {
  id: number;
  ok: false;
  code: PsdErrorCode;
  message: string;
}

export type PsdResponse = PsdCompositeResult | PsdLayersResult | PsdFailure;
