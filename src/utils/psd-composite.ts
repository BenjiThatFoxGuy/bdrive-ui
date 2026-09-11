import { BLEND_MODES, type PsdLayerNode } from "./psd";

// Rebuilds a document from its layers onto one canvas. This is an approximation, and
// deliberately so - see BLEND_MODES in psd.ts for the modes Canvas 2D can't express.
// The other standing compromises, each unavoidable without a custom pixel pipeline:
//
//   - clipped layers blend against their base layer, not the full backdrop below it
//   - groups are always isolated, so "pass through" behaves as Normal
//   - vector masks and layer effects (drop shadow, stroke, glow) are ignored
//   - adjustment layers have no pixel data and render as no-ops
//
// No React and no worker in here, so the whole layers feature can be deleted by
// dropping this file and the panel.

export function renderDocument({ target, doc, images, visible, maxDim }: RenderArgs) {
  const scale = Math.min(1, maxDim / Math.max(doc.width, doc.height));
  const width = Math.max(1, Math.round(doc.width * scale));
  const height = Math.max(1, Math.round(doc.height * scale));

  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;

  const ctx = target.getContext("2d");
  if (!ctx) return;

  // Allocating document-sized scratch canvases per layer is an instant out-of-memory
  // at 4096² (64MB each), so they're pooled and handed back after every use.
  const pool = createScratchPool(width, height, scale);

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, doc.width, doc.height);

  drawNodes({ ctx, nodes: doc.tree, images, visible, pool });

  pool.dispose();
}

function drawNodes({ ctx, nodes, images, visible, pool }: DrawArgs) {
  let i = 0;

  // nodes[0] is the BOTTOM layer: ag-psd returns children in PSD file order, which is
  // bottom-most first, so this iterates forward and paints upward.
  while (i < nodes.length) {
    const node = nodes[i];

    // A clipping run always sits directly above the layer it clips to.
    const clipped: PsdLayerNode[] = [];
    let j = i + 1;
    while (j < nodes.length && nodes[j].clipping) {
      if (isVisible(nodes[j], visible)) clipped.push(nodes[j]);
      j += 1;
    }

    if (!isVisible(node, visible)) {
      // A hidden base takes its whole clipped run with it, and a hidden group is
      // never recursed into - which is why a child's own flag survives untouched.
      i = j;
      continue;
    }

    if (clipped.length === 0 && canDrawDirect(node)) {
      const source = images[node.id];
      if (source) paintDirect({ ctx, source, node });
      i = j;
      continue;
    }

    const base = renderNode({ node, images, visible, pool });

    if (clipped.length === 0) {
      paint({ ctx, source: base.canvas, node });
      pool.release(base);
      i = j;
      continue;
    }

    const stack = pool.acquire();
    stack.ctx.drawImage(base.canvas, 0, 0);

    for (const clip of clipped) {
      const layer = renderNode({ node: clip, images, visible, pool });
      stack.ctx.globalAlpha = clip.opacity;
      stack.ctx.globalCompositeOperation = blendOf(clip);
      stack.ctx.drawImage(layer.canvas, 0, 0);
      pool.release(layer);
    }

    // Clip the whole run to the base layer's alpha, then let the base's own opacity
    // and blend mode apply to the result.
    stack.ctx.globalAlpha = 1;
    stack.ctx.globalCompositeOperation = "destination-in";
    stack.ctx.drawImage(base.canvas, 0, 0);
    stack.ctx.globalCompositeOperation = "source-over";

    paint({ ctx, source: stack.canvas, node });

    pool.release(base);
    pool.release(stack);
    i = j;
  }
}

function renderNode({ node, images, visible, pool }: RenderNodeArgs): Scratch {
  const scratch = pool.acquire();

  if (node.children) {
    drawNodes({ ctx: scratch.ctx, nodes: node.children, images, visible, pool });
  } else {
    const source = images[node.id];
    if (source) scratch.ctx.drawImage(source, node.left, node.top);
  }

  applyMask({ scratch, node, images, pool });

  return scratch;
}

function applyMask({ scratch, node, images, pool }: ApplyMaskArgs) {
  if (!node.mask || node.mask.disabled) return;

  const source = images[`${node.id}:mask`];
  if (!source) return;

  const mask = pool.acquire();

  // defaultColor 255 means everything outside the mask rect stays opaque, so seed the
  // stencil opaque and let the mask bitmap carve into it.
  if (node.mask.defaultOpaque) {
    mask.ctx.fillStyle = "#000";
    mask.ctx.fillRect(0, 0, mask.docWidth, mask.docHeight);
  }

  mask.ctx.drawImage(source, node.mask.left, node.mask.top);

  scratch.ctx.globalCompositeOperation = "destination-in";
  scratch.ctx.drawImage(mask.canvas, 0, 0);
  scratch.ctx.globalCompositeOperation = "source-over";

  pool.release(mask);
}

function paint({ ctx, source, node }: PaintArgs) {
  ctx.save();
  ctx.globalAlpha = node.opacity;
  ctx.globalCompositeOperation = blendOf(node);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

function paintDirect({ ctx, source, node }: PaintDirectArgs) {
  ctx.save();
  ctx.globalAlpha = node.opacity;
  ctx.globalCompositeOperation = blendOf(node);
  ctx.drawImage(source, node.left, node.top);
  ctx.restore();
}

// The common case by a wide margin, and what keeps toggling interactive: a plain
// raster layer with no mask and nothing clipped to it goes straight onto the target.
function canDrawDirect(node: PsdLayerNode) {
  return !node.children && !node.mask;
}

function blendOf(node: PsdLayerNode): GlobalCompositeOperation {
  return BLEND_MODES[node.blendMode] ?? "source-over";
}

// Only the layer's own flag - a hidden group short-circuits before its children are
// ever visited, which is what makes unhiding a group restore each child's individual
// state instead of a cascade having overwritten it.
function isVisible(node: PsdLayerNode, visible: Record<string, boolean>) {
  return visible[node.id] !== false;
}

function createScratchPool(width: number, height: number, scale: number): ScratchPool {
  const free: Scratch[] = [];
  const all: Scratch[] = [];
  const docWidth = width / scale;
  const docHeight = height / scale;

  return {
    acquire() {
      const reused = free.pop();
      if (reused) {
        reused.ctx.setTransform(1, 0, 0, 1, 0, 0);
        reused.ctx.clearRect(0, 0, width, height);
        reused.ctx.setTransform(scale, 0, 0, scale, 0, 0);
        reused.ctx.globalAlpha = 1;
        reused.ctx.globalCompositeOperation = "source-over";
        return reused;
      }

      // OffscreenCanvas where available: no DOM node, and cheaper to allocate.
      const canvas =
        typeof OffscreenCanvas === "function"
          ? new OffscreenCanvas(width, height)
          : document.createElement("canvas");

      if (!(canvas instanceof OffscreenCanvas)) {
        canvas.width = width;
        canvas.height = height;
      }

      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.setTransform(scale, 0, 0, scale, 0, 0);

      const scratch: Scratch = { canvas, ctx: context, docWidth, docHeight };
      all.push(scratch);
      return scratch;
    },

    release(scratch) {
      free.push(scratch);
    },

    dispose() {
      for (const scratch of all) {
        scratch.canvas.width = 0;
        scratch.canvas.height = 0;
      }
      free.length = 0;
      all.length = 0;
    },
  };
}

export interface PsdDocument {
  width: number;
  height: number;
  tree: PsdLayerNode[];
}

interface Scratch {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D;
  docWidth: number;
  docHeight: number;
}

interface ScratchPool {
  acquire(): Scratch;
  release(scratch: Scratch): void;
  dispose(): void;
}

interface RenderArgs {
  target: HTMLCanvasElement;
  doc: PsdDocument;
  images: Record<string, CanvasImageSource>;
  visible: Record<string, boolean>;
  maxDim: number;
}

interface DrawArgs {
  ctx: CanvasRenderingContext2D;
  nodes: PsdLayerNode[];
  images: Record<string, CanvasImageSource>;
  visible: Record<string, boolean>;
  pool: ScratchPool;
}

interface RenderNodeArgs {
  node: PsdLayerNode;
  images: Record<string, CanvasImageSource>;
  visible: Record<string, boolean>;
  pool: ScratchPool;
}

interface ApplyMaskArgs {
  scratch: Scratch;
  node: PsdLayerNode;
  images: Record<string, CanvasImageSource>;
  pool: ScratchPool;
}

interface PaintArgs {
  ctx: CanvasRenderingContext2D;
  source: CanvasImageSource;
  node: PsdLayerNode;
}

interface PaintDirectArgs {
  ctx: CanvasRenderingContext2D;
  source: CanvasImageSource;
  node: PsdLayerNode;
}
