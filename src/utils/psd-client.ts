import { PsdError, type PsdCompositeResult, type PsdLayersResult, type PsdResponse } from "./psd";

// The single seam between the UI and the parser. Components await these methods and
// never learn a worker exists, which is what makes the worker swappable (see the
// fallback note in the plan) and the layers half removable.
//
// The worker exists for cancellability more than speed: readPsd is a synchronous,
// uninterruptible call that inflates every channel through pako, so on the main
// thread a large PSD would freeze React, the spinner and the router for seconds, and
// a query signal would mean nothing. terminate() is the only real abort primitive.

export function createPsdSession(): PsdSession {
  let worker: Worker | undefined;
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();

  function ensureWorker() {
    if (worker) return worker;

    // Vite needs this exact static, relative literal to emit the worker chunk - an
    // "@/" alias here does not work.
    worker = new Worker(new URL("./psd-worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (event: MessageEvent<PsdResponse>) => {
      const response = event.data;
      const request = pending.get(response.id);
      if (!request) return;

      pending.delete(response.id);

      if (!response.ok) {
        request.reject(new PsdError(response.code, response.message));
        return;
      }

      request.resolve(response);
    };

    // An out-of-memory kill inside the worker surfaces here rather than as a
    // rejected message.
    const crash = () => rejectAll(new PsdError("worker", WORKER_CRASH_MESSAGE));
    worker.onerror = crash;
    worker.onmessageerror = crash;

    return worker;
  }

  function rejectAll(error: Error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = undefined;
  }

  function send<T extends PsdResponse>(
    message: Record<string, unknown>,
    { signal, transfer }: { signal?: AbortSignal; transfer?: Transferable[] },
  ) {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }

      const id = nextId++;
      const active = ensureWorker();
      pending.set(id, { resolve: resolve as PendingRequest["resolve"], reject });

      const onAbort = () => {
        pending.delete(id);
        // readPsd can't be interrupted, and by the time an abort fires (modal
        // closed, moved to the next file) the in-flight parse is worthless anyway.
        // Kill the worker; the next request spawns a fresh one.
        rejectAll(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      active.postMessage({ ...message, id }, transfer ?? []);
    });
  }

  return {
    composite({ buffer, retain, maxDocPixels, signal }) {
      return send<PsdCompositeResult>(
        { kind: "composite", buffer, retain, maxDocPixels },
        { signal, transfer: [buffer] },
      );
    },

    layers({ signal }) {
      return send<PsdLayersResult>({ kind: "layers" }, { signal });
    },

    dispose() {
      pending.clear();
      worker?.terminate();
      worker = undefined;
    },
  };
}

// ImageBitmaps hold GPU-side memory that isn't promptly collected, so every one has
// to be closed when a preview unmounts. Without this, paging through a folder of
// PSDs with the arrow keys leaks steadily.
export function closePsdImages(images: Record<string, { type: string; bitmap?: ImageBitmap }>) {
  for (const image of Object.values(images)) {
    if (image.type === "bitmap") image.bitmap?.close();
  }
}

const WORKER_CRASH_MESSAGE = "The browser ran out of memory opening this Photoshop file.";

interface PendingRequest {
  resolve: (value: PsdResponse) => void;
  reject: (reason: unknown) => void;
}

export interface PsdSession {
  composite(args: {
    buffer: ArrayBuffer;
    retain: boolean;
    maxDocPixels: number;
    signal?: AbortSignal;
  }): Promise<PsdCompositeResult>;
  layers(args: { signal?: AbortSignal }): Promise<PsdLayersResult>;
  dispose(): void;
}
