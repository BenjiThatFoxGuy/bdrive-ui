import clsx from "clsx";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type PsdDocument, renderDocument } from "@/utils/psd-composite";

function PsdCanvas({ doc, images, visible, composite, maxDim }: PsdCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const [box, setBox] = useState<Box>();

  // CSS alone can't letterbox a known aspect ratio in both orientations - a
  // max-height clamp won't shrink the width back - so the fit is measured. It also
  // keeps the checkerboard tight to the artwork instead of flooding the preview.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fit = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      const scale = Math.min(width / doc.width, height / doc.height);
      setBox({ width: doc.width * scale, height: doc.height * scale });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [doc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Coalesce rapid toggling down to one composite per frame.
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      if (images && visible) {
        renderDocument({ target: canvas, doc, images, visible, maxDim });
        return;
      }

      // Tier 1: nothing to composite from yet, so blit the document's merged image.
      if (!composite) return;

      const scale = Math.min(1, maxDim / Math.max(doc.width, doc.height));
      canvas.width = Math.max(1, Math.round(doc.width * scale));
      canvas.height = Math.max(1, Math.round(doc.height * scale));

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, doc.width, doc.height);
      ctx.drawImage(composite, 0, 0);
    });

    return () => cancelAnimationFrame(frameRef.current);
  }, [doc, images, visible, composite, maxDim]);

  return (
    // The padding sits on the outer element so the measured box is exactly the space
    // available to the artwork.
    <div className="size-full p-4">
      <div ref={containerRef} className="flex size-full items-center justify-center">
        <div
          className={clsx("relative", checkerboard)}
          style={box && { width: box.width, height: box.height }}
        >
          <canvas ref={canvasRef} className="block size-full" />
        </div>
      </div>
    </div>
  );
}

// A transparency checkerboard, so a PSD with an empty background reads as transparent
// rather than as whatever the modal surface happens to be.
const checkerboard =
  "bg-[conic-gradient(from_90deg_at_50%_50%,#0000_25%,#80808026_0_50%,#0000_0_75%,#80808026_0)] bg-[length:16px_16px]";

interface Box {
  width: number;
  height: number;
}

interface PsdCanvasProps {
  doc: PsdDocument;
  images?: Record<string, CanvasImageSource>;
  visible?: Record<string, boolean>;
  composite?: CanvasImageSource;
  maxDim: number;
}

export default memo(PsdCanvas);
