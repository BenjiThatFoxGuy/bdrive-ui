import { azteccode, code128, pdf417, qrcode } from "@bwip-js/browser";
import clsx from "clsx";
import { memo, useEffect, useRef, useState } from "react";

import type { PassBarcode } from "@/utils/pkpass";

const PassBarcodeView = ({ barcode }: { barcode: PassBarcode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  const { message, altText } = barcode;
  const symbology = SYMBOLOGIES[barcode.format as keyof typeof SYMBOLOGIES];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !symbology || !message) return;

    try {
      symbology.encode(canvas, { bcid: symbology.bcid, text: message, ...symbology.options });
      setFailed(false);
    } catch {
      // bwip-js rejects payloads a symbology can't encode, and throws plain
      // strings rather than Errors. Showing the raw message still lets the
      // user read a booking reference off a pass we can't draw.
      setFailed(true);
    }
  }, [symbology, message]);

  const renderable = Boolean(symbology && message) && !failed;

  // The quiet zone stays white whatever the pass background is, otherwise
  // scanners won't pick the code up.
  return (
    <div className="mx-auto flex w-fit max-w-full flex-col items-center gap-2 rounded-xl bg-white px-3 py-3">
      <canvas
        ref={canvasRef}
        className={clsx(
          "h-auto w-full",
          symbology?.wide ? "max-w-72" : "max-w-52",
          !renderable && "hidden",
        )}
      />
      {!renderable && (
        <p className="max-w-72 break-all text-center font-mono text-body-small text-black">
          {message || "This pass has no barcode."}
        </p>
      )}
      {altText && <p className="text-center text-label-small text-black">{altText}</p>}
    </div>
  );
};

// Importing the four Wallet symbologies directly rather than the generic
// toCanvas() dispatcher keeps the other hundred-odd encoders out of the bundle.
const SYMBOLOGIES = {
  PKBarcodeFormatQR: {
    bcid: "qrcode",
    encode: qrcode,
    wide: false,
    options: { scale: 4, paddingwidth: 1, paddingheight: 1 },
  },
  PKBarcodeFormatAztec: {
    bcid: "azteccode",
    encode: azteccode,
    wide: false,
    options: { scale: 4, paddingwidth: 1, paddingheight: 1 },
  },
  PKBarcodeFormatPDF417: {
    bcid: "pdf417",
    encode: pdf417,
    wide: true,
    options: { scale: 3, paddingwidth: 1, paddingheight: 1 },
  },
  PKBarcodeFormatCode128: {
    bcid: "code128",
    encode: code128,
    wide: true,
    options: { scale: 3, height: 12, includetext: false, paddingwidth: 1, paddingheight: 1 },
  },
} as const;

export default memo(PassBarcodeView);
