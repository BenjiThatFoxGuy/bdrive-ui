/**
 * Hook that transforms a FileData array's thumbnail URLs so they retry with
 * exponential backoff when the backend is still generating the thumbnail.
 *
 * Returns a new array reference only when a thumbnail resolves, so the file
 * browser re-renders just the affected entries.
 */

import { useEffect, useRef, useState } from "react";
import type { FileData } from "@tw-material/file-browser";
import toast from "react-hot-toast";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2_000;

// Session-wide caches shared across every file browser instance.
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

// Shared non-dismissible toast for thumbnail loading.
const TOAST_ID = "thumbnail-loading";
let pendingCount = 0;

function updateLoadingToast() {
  if (pendingCount > 0) {
    toast.loading(
      pendingCount === 1
        ? "Generating 1 thumbnail..."
        : `Generating ${pendingCount} thumbnails...`,
      { id: TOAST_ID, duration: Infinity },
    );
  } else {
    toast.dismiss(TOAST_ID);
  }
}

function probeImage(url: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => reject(new Error("not ready"));
    img.src = url;
  });
}

async function fetchWithRetry(url: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await probeImage(url);
    } catch {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) =>
          setTimeout(r, BASE_DELAY_MS * 2 ** attempt),
        );
      }
    }
  }
  return url;
}

function resolveThumb(url: string): Promise<string> {
  const cached = resolved.get(url);
  if (cached) return Promise.resolve(cached);

  let pending = inflight.get(url);
  if (!pending) {
    pendingCount++;
    updateLoadingToast();
    pending = fetchWithRetry(url).then((result) => {
      resolved.set(url, result);
      inflight.delete(url);
      pendingCount = Math.max(0, pendingCount - 1);
      updateLoadingToast();
      return result;
    });
    inflight.set(url, pending);
  }
  return pending;
}

/**
 * Takes the files array from the query and returns a copy where thumbnail URLs
 * that haven't loaded yet are blanked out (so the file browser shows the icon
 * instead of a broken image), then swapped in once the backend serves them.
 */
export function useResolvedThumbnails<T extends (FileData | null)[]>(
  files: T,
): T;
export function useResolvedThumbnails<T extends (FileData | null)[]>(
  files: T | undefined,
): T | undefined;
export function useResolvedThumbnails<T extends (FileData | null)[]>(
  files: T | undefined,
): T | undefined {
  // Track which thumbnail URLs have been confirmed ready.
  const [readyUrls, setReadyUrls] = useState<ReadonlySet<string>>(
    () => new Set(resolved.keys()),
  );
  const generationRef = useRef(0);

  useEffect(() => {
    if (!files) return;
    let cancelled = false;
    const gen = ++generationRef.current;

    const pending: string[] = [];
    for (const file of files) {
      if (!file?.thumbnailUrl) continue;
      if (resolved.has(file.thumbnailUrl)) continue;
      pending.push(file.thumbnailUrl);
    }

    if (pending.length === 0) return;

    // Kick off all unresolved thumbnails, then batch-update state once any resolve.
    const promises = pending.map((url) =>
      resolveThumb(url).then((result) => {
        if (cancelled || gen !== generationRef.current) return;
        setReadyUrls((prev) => {
          if (prev.has(result)) return prev;
          const next = new Set(prev);
          next.add(result);
          return next;
        });
      }),
    );

    // Single cleanup for all in-flight probes.
    void Promise.allSettled(promises);

    return () => {
      cancelled = true;
    };
  }, [files]);

  if (!files) return files;

  // Return a mapped array: thumbnailUrl is kept if resolved, cleared if still
  // loading (shows the type icon instead of a broken image placeholder).
  return files.map((file) => {
    if (!file?.thumbnailUrl) return file;
    if (readyUrls.has(file.thumbnailUrl)) return file;
    // Not ready yet: show the file icon instead of a broken <img>.
    return { ...file, thumbnailUrl: "" };
  }) as T;
}