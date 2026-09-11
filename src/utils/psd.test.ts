import { describe, expect, test } from "bun:test";

import {
  assertPsdHeader,
  BLEND_MODES,
  layersVerdict,
  MAX_LAYER_PIXEL_BYTES,
  MAX_LAYERS,
  PsdError,
  type PsdBudget,
} from "./psd";

const budget: PsdBudget = {
  maxPreviewBytes: 256 * 1024 * 1024,
  maxDocPixels: 64 * 1024 * 1024,
  maxLayers: MAX_LAYERS,
  maxLayerPixelBytes: MAX_LAYER_PIXEL_BYTES,
  renderMaxDim: 4096,
};

function header({ version = 1, width = 512, height = 512 } = {}) {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x38425053);
  view.setUint16(4, version);
  view.setUint16(12, 4);
  view.setUint32(14, height);
  view.setUint32(18, width);
  view.setUint16(22, 8);
  view.setUint16(24, 3);
  return bytes.buffer;
}

function codeOf(run: () => unknown) {
  try {
    run();
    return "no error";
  } catch (error) {
    return error instanceof PsdError ? error.code : "wrong error type";
  }
}

describe("assertPsdHeader", () => {
  test("reads dimensions from a valid header", () => {
    expect(assertPsdHeader(header({ width: 800, height: 600 }), budget)).toMatchObject({
      width: 800,
      height: 600,
      depth: 8,
    });
  });

  test("rejects a file that isn't a PSD", () => {
    expect(codeOf(() => assertPsdHeader(new ArrayBuffer(32), budget))).toBe("signature");
  });

  test("rejects a file too short to hold a header", () => {
    expect(codeOf(() => assertPsdHeader(new ArrayBuffer(4), budget))).toBe("signature");
  });

  test("rejects .psb, which is version 2", () => {
    expect(codeOf(() => assertPsdHeader(header({ version: 2 }), budget))).toBe("psb");
  });

  test("rejects an unknown format version", () => {
    expect(codeOf(() => assertPsdHeader(header({ version: 7 }), budget))).toBe("version");
  });

  test("rejects a document with more pixels than the budget allows", () => {
    const oversized = header({ width: 30000, height: 30000 });
    expect(codeOf(() => assertPsdHeader(oversized, budget))).toBe("too-large-canvas");
  });

  test("accepts a document exactly at the pixel budget", () => {
    const exact = header({ width: 8192, height: 8192 });
    expect(assertPsdHeader(exact, budget).width).toBe(8192);
  });
});

describe("BLEND_MODES", () => {
  // Every mode Canvas 2D can express should be mapped; anything else must be absent
  // so the UI can tell the user it's approximated.
  test("maps each supported mode to its canvas equivalent", () => {
    for (const [psdMode, canvasMode] of Object.entries(SUPPORTED))
      expect(BLEND_MODES[psdMode]).toBe(canvasMode);
  });

  test("leaves modes with no canvas equivalent unmapped", () => {
    for (const mode of UNSUPPORTED) expect(BLEND_MODES[mode]).toBeUndefined();
  });

  test("covers every blend mode PSD can store", () => {
    const known = new Set([...Object.keys(SUPPORTED), ...UNSUPPORTED]);
    for (const mode of Object.keys(BLEND_MODES)) expect(known.has(mode)).toBe(true);
  });
});

describe("layersVerdict", () => {
  test("allows a file within both budgets", () => {
    expect(layersVerdict({ layerCount: 12, layerPixelBytes: 1024, budget }).available).toBe(true);
  });

  test("refuses a file with no layers", () => {
    expect(layersVerdict({ layerCount: 0, layerPixelBytes: 0, budget }).available).toBe(false);
  });

  test("allows a file exactly at both limits", () => {
    const verdict = layersVerdict({
      layerCount: budget.maxLayers,
      layerPixelBytes: budget.maxLayerPixelBytes,
      budget,
    });
    expect(verdict.available).toBe(true);
  });

  test("refuses one layer past the count limit", () => {
    const verdict = layersVerdict({
      layerCount: budget.maxLayers + 1,
      layerPixelBytes: 1024,
      budget,
    });
    expect(verdict.available).toBe(false);
    // The reason carries real numbers so the limit doesn't read as arbitrary.
    expect(verdict.reason).toContain(String(budget.maxLayers + 1));
  });

  test("refuses one byte past the pixel-data limit, and says how much", () => {
    const verdict = layersVerdict({
      layerCount: 10,
      layerPixelBytes: budget.maxLayerPixelBytes + 1,
      budget,
    });
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain("192 MB");
  });
});

const SUPPORTED: Record<string, GlobalCompositeOperation> = {
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
  // Group-only, and deliberately mapped rather than flagged: it's Photoshop's default
  // for every new group, so treating it as unsupported would warn on nearly any file.
  "pass through": "source-over",
};

const UNSUPPORTED = [
  "dissolve",
  "linear burn",
  "linear dodge",
  "vivid light",
  "linear light",
  "pin light",
  "hard mix",
  "subtract",
  "divide",
  "darker color",
  "lighter color",
];
