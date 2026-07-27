import { unzipSync } from "fflate";

// A .pkpass is a zip holding pass.json, PNG artwork, an optional <lang>.lproj
// directory per localization, plus manifest.json and a PKCS#7 signature. The
// signature can't be checked in a browser (there's no path to Apple's root
// certificates), so nothing here should be presented to the user as verified.

const MAX_ENTRIES = 256;

const MAX_UNPACKED_BYTES = 32 * 1024 * 1024;

const PASS_STYLES = ["boardingPass", "coupon", "eventTicket", "storeCard", "generic"] as const;

const IMAGE_NAMES = ["logo", "icon", "strip", "thumbnail", "background", "footer"] as const;

// Only pass.json, artwork and localization data are worth inflating. Skipping
// the signature and manifest also keeps the size budget for content we render.
const wantedEntry = (name: string) => {
  const base = name.split("/").pop() ?? "";
  if (base === "pass.json" || base === "pass.strings") return true;
  return base.endsWith(".png");
};

export class PassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PassError";
  }
}

export function parsePass(buffer: ArrayBuffer): ParsedPass {
  const entries = readEntries(buffer);

  const passEntry = Object.keys(entries).find(
    (name) => name === "pass.json" || name.endsWith("/pass.json"),
  );
  if (!passEntry) throw new PassError("This archive has no pass.json, so there's nothing to show.");

  let pass: Pass;
  try {
    // TextDecoder strips a UTF-8 BOM on its own, which some pass generators emit.
    pass = JSON.parse(new TextDecoder().decode(entries[passEntry]));
  } catch {
    throw new PassError("The pass.json inside this file is malformed.");
  }

  if (pass.formatVersion !== undefined && pass.formatVersion !== 1)
    throw new PassError(`Unsupported pass format version ${pass.formatVersion}.`);

  const style = PASS_STYLES.find((candidate) => pass[candidate]);
  if (!style) throw new PassError("This pass doesn't declare a known style.");

  const language = pickLanguage(Object.keys(entries));

  return {
    pass: localizePass(pass, readStrings(entries, language)),
    style,
    images: readImages(entries, language),
  };
}

export function passFields(pass: Pass, style: PassStyle) {
  return (pass[style] ?? {}) as PassStructure;
}

export function barcodeOf(pass: Pass): PassBarcode | undefined {
  return pass.barcodes?.find((code) => code.message) ?? pass.barcode;
}

export function isExpired(pass: Pass) {
  if (!pass.expirationDate) return false;
  const expiry = new Date(pass.expirationDate).getTime();
  return !Number.isNaN(expiry) && expiry < Date.now();
}

// pass.json colors arrive as untrusted strings, so anything that isn't plainly
// an rgb()/rgba()/hex literal is discarded rather than passed into a style prop.
export function cssColor(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (RGB_PATTERN.test(trimmed) || HEX_PATTERN.test(trimmed)) return trimmed;
  return fallback;
}

// Wallet renders a field's value through the date, currency or number
// formatter it declares, and falls back to the raw string otherwise.
export function formatFieldValue(field: PassField): string {
  const { value } = field;
  if (value === undefined || value === null) return "";

  const dateOptions = dateFormatOptions(field);
  if (dateOptions) {
    const date = new Date(value as string);
    if (!Number.isNaN(date.getTime()))
      return new Intl.DateTimeFormat(undefined, dateOptions).format(date);
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric) && value !== "") {
    if (field.currencyCode) {
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: field.currencyCode,
        }).format(numeric);
      } catch {
        // An invalid currency code makes Intl throw; show the bare number.
      }
    }
    const numberOptions = NUMBER_STYLES[field.numberStyle as PassNumberStyle];
    if (numberOptions) return new Intl.NumberFormat(undefined, numberOptions).format(numeric);
  }

  return String(value);
}

export function textAlignClass(field: PassField, fallback = "text-left") {
  return TEXT_ALIGNMENTS[field.textAlignment as PassTextAlignment] ?? fallback;
}

function readEntries(buffer: ArrayBuffer) {
  let remaining = MAX_UNPACKED_BYTES;
  let count = 0;

  try {
    return unzipSync(new Uint8Array(buffer), {
      filter: ({ name, originalSize }) => {
        if (!wantedEntry(name)) return false;
        if (++count > MAX_ENTRIES)
          throw new PassError("This pass holds too many files to preview.");
        remaining -= originalSize;
        if (remaining < 0) throw new PassError("This pass is too large to preview.");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof PassError) throw error;
    throw new PassError("This file isn't a readable .pkpass archive.");
  }
}

// Localized resources live in <lang>.lproj directories. Match the browser's
// preferred languages against those, exact region first, then bare language.
function pickLanguage(names: string[]) {
  const available = new Set<string>();
  for (const name of names) {
    const [dir] = name.split("/");
    if (dir?.endsWith(".lproj")) available.add(dir.slice(0, -".lproj".length));
  }
  if (!available.size) return undefined;

  const languages = [...(navigator.languages ?? [navigator.language])].filter(Boolean);
  for (const preferred of languages) {
    const wanted = preferred.toLowerCase();
    for (const candidate of available) if (candidate.toLowerCase() === wanted) return candidate;
    const base = wanted.split("-")[0];
    for (const candidate of available)
      if (candidate.toLowerCase().split("-")[0] === base) return candidate;
  }
  return undefined;
}

function readStrings(entries: Record<string, Uint8Array>, language: string | undefined) {
  const table: Record<string, string> = {};
  if (!language) return table;

  const bytes = entries[`${language}.lproj/pass.strings`];
  if (!bytes) return table;

  const source = decodeStrings(bytes);
  // Entries look like: "key" = "value";  with C-style escapes in both halves.
  const pattern = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
  for (const match of source.matchAll(pattern))
    table[unescapeString(match[1])] = unescapeString(match[2]);
  return table;
}

// pass.strings is conventionally UTF-16 with a BOM, but UTF-8 shows up too.
function decodeStrings(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder().decode(bytes);
}

function unescapeString(value: string) {
  return value.replace(/\\(.)/g, (_, char: string) => ESCAPES[char] ?? char);
}

function readImages(entries: Record<string, Uint8Array>, language: string | undefined) {
  // Prefer the artwork closest to the display density, then anything present.
  const density = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const scales =
    density >= 3 ? ["@3x", "@2x", ""] : density === 2 ? ["@2x", "@3x", ""] : ["", "@2x", "@3x"];
  const dirs = language ? [`${language}.lproj/`, ""] : [""];

  const images: PassImages = {};
  for (const name of IMAGE_NAMES) {
    for (const dir of dirs) {
      const scale = scales.find((suffix) => entries[`${dir}${name}${suffix}.png`]);
      if (scale === undefined) continue;
      images[name] = new Blob([entries[`${dir}${name}${scale}.png`] as BlobPart], {
        type: "image/png",
      });
      break;
    }
  }
  return images;
}

// Any user-visible string in pass.json may instead be a key into pass.strings.
function localizePass(pass: Pass, table: Record<string, string>) {
  if (!Object.keys(table).length) return pass;

  const translate = (value: unknown) =>
    typeof value === "string" && table[value] !== undefined ? table[value] : value;

  const localized = structuredClone(pass);
  localized.logoText = translate(localized.logoText) as string | undefined;
  localized.description = translate(localized.description) as string | undefined;
  localized.organizationName = translate(localized.organizationName) as string | undefined;

  for (const code of [...(localized.barcodes ?? []), localized.barcode])
    if (code) code.altText = translate(code.altText) as string | undefined;

  for (const style of PASS_STYLES) {
    const structure = localized[style];
    if (!structure) continue;
    for (const group of FIELD_GROUPS)
      for (const field of structure[group] ?? []) {
        field.label = translate(field.label) as string | undefined;
        field.value = translate(field.value) as PassField["value"];
        field.changeMessage = translate(field.changeMessage) as string | undefined;
      }
  }

  return localized;
}

function dateFormatOptions(field: PassField) {
  const options: Intl.DateTimeFormatOptions = {};
  const dateStyle = DATE_STYLES[field.dateStyle as PassDateStyle];
  const timeStyle = DATE_STYLES[field.timeStyle as PassDateStyle];
  if (dateStyle) options.dateStyle = dateStyle;
  if (timeStyle) options.timeStyle = timeStyle;
  if (field.ignoresTimeZone) options.timeZone = "UTC";
  return dateStyle || timeStyle ? options : undefined;
}

const RGB_PATTERN =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "0": "\0",
};

const DATE_STYLES = {
  PKDateStyleNone: undefined,
  PKDateStyleShort: "short",
  PKDateStyleMedium: "medium",
  PKDateStyleLong: "long",
  PKDateStyleFull: "full",
} as const;

const NUMBER_STYLES = {
  PKNumberStyleDecimal: { style: "decimal" },
  PKNumberStylePercent: { style: "percent" },
  PKNumberStyleScientific: { notation: "scientific" },
  // Intl has no spell-out equivalent, so these render as plain decimals.
  PKNumberStyleSpellOut: { style: "decimal" },
} as const satisfies Record<string, Intl.NumberFormatOptions>;

const TEXT_ALIGNMENTS = {
  PKTextAlignmentLeft: "text-left",
  PKTextAlignmentCenter: "text-center",
  PKTextAlignmentRight: "text-right",
  PKTextAlignmentNatural: "text-start",
} as const;

export const FIELD_GROUPS = [
  "headerFields",
  "primaryFields",
  "secondaryFields",
  "auxiliaryFields",
  "backFields",
] as const;

export type PassStyle = (typeof PASS_STYLES)[number];

export type PassImageName = (typeof IMAGE_NAMES)[number];

export type PassImages = Partial<Record<PassImageName, Blob>>;

type PassDateStyle = keyof typeof DATE_STYLES;

type PassNumberStyle = keyof typeof NUMBER_STYLES;

type PassTextAlignment = keyof typeof TEXT_ALIGNMENTS;

export interface PassField {
  key: string;
  label?: string;
  value?: string | number;
  changeMessage?: string;
  textAlignment?: string;
  dateStyle?: string;
  timeStyle?: string;
  ignoresTimeZone?: boolean;
  isRelative?: boolean;
  currencyCode?: string;
  numberStyle?: string;
}

export interface PassStructure {
  headerFields?: PassField[];
  primaryFields?: PassField[];
  secondaryFields?: PassField[];
  auxiliaryFields?: PassField[];
  backFields?: PassField[];
  transitType?: string;
}

export interface PassBarcode {
  format?: string;
  message?: string;
  messageEncoding?: string;
  altText?: string;
}

export interface Pass {
  formatVersion?: number;
  description?: string;
  organizationName?: string;
  logoText?: string;
  serialNumber?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  labelColor?: string;
  relevantDate?: string;
  expirationDate?: string;
  voided?: boolean;
  barcode?: PassBarcode;
  barcodes?: PassBarcode[];
  boardingPass?: PassStructure;
  coupon?: PassStructure;
  eventTicket?: PassStructure;
  storeCard?: PassStructure;
  generic?: PassStructure;
}

export interface ParsedPass {
  pass: Pass;
  style: PassStyle;
  images: PassImages;
}
