import pLimit from "p-limit";


import type { components } from "@/lib/api";
import { fetchClient } from "@/utils/api";
import { formatTime, zeroPad } from "@/utils/common";
import type { UploadParams } from "./types";

// MD5 hash function resolver - loads implementation based on environment
let md5HashResolver: (() => Promise<(input: string) => string>) | null = null;

async function getMd5Hash(): Promise<(input: string) => string> {
  if (md5HashResolver) {
    return md5HashResolver();
  }

  return new Promise((resolve) => {
    if (typeof window !== 'undefined') {
      // Browser environment - use the md5 package
      import('md5').then((module) => {
        const hashFn = module.default;
        md5HashResolver = () => Promise.resolve(hashFn);
        resolve(hashFn);
      });
    } else {
      // Node.js environment (for build/SSR) - use built-in crypto
      import('crypto').then(({ createHash }) => {
        const hashFn = (input: string) =>
          createHash('md5').update(input, 'utf8').digest('hex');
        md5HashResolver = () => Promise.resolve(hashFn);
        resolve(hashFn);
      });
    }
  });
}


function generateUUID(): string {
  // Check if crypto.randomUUID is available and call it to generate a UUID
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return crypto.randomUUID();
  }

  // Fallback to Date.now() if crypto.randomUUID is not available
  return Date.now().toString();
}



// Computes the deterministic upload id used to address in-progress upload parts
// for a file. Mirrors the id used inside uploadFile so callers can clean up
// orphaned parts via DELETE /api/uploads/{id}.
export const computeUploadId = async (
  file: File,
  path: string,
  userId: number,
): Promise<string> => {
  const hashFn = await getMd5Hash();
  return hashFn(
    `${path}/${file.name}${file.size.toString()}${formatTime(file.lastModified)}${userId}`,
  );
};

// Deletes any uploaded parts associated with an upload id. Best-effort: failures
// are swallowed so cleanup never blocks the surrounding flow.
export const deleteUploadParts = async (uploadId: string): Promise<void> => {
  try {
    await fetchClient.DELETE("/uploads/{id}", {
      params: { path: { id: uploadId } },
    });
  } catch {
    // ignore – the parts may not exist yet or were already removed.
  }
};

// Returns true when a file with the exact name already exists in the destination
// folder. Uses the find operation scoped to active files only.
export const checkFileExists = async (
  path: string,
  name: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  const res = (
    await fetchClient.GET("/files", {
      params: {
        query: {
          path,
          name,
          operation: "find",
          type: "file",
          status: "active",
        },
      },
      signal,
    })
  ).data;
  return Boolean(res && res.items.length > 0);
};

// Splits a filename into [base, ext] where ext keeps its leading dot. Returns an
// empty extension for names without one (and for dotfiles like ".env").
const splitName = (name: string): [string, string] => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
};

// Produces a unique name by appending " (n)" before the extension
// (report.pdf -> report (1).pdf -> report (2).pdf ...), checking each candidate
// against the supplied predicate until a free name is found.
export const generateUniqueName = async (
  originalName: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  if (!(await isTaken(originalName))) return originalName;
  const [base, ext] = splitName(originalName);
  for (let n = 1; n <= 10000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Extremely unlikely fallback to guarantee uniqueness.
  return `${base} (${Date.now()})${ext}`;
};

export const uploadChunk = <T extends {}>(
  url: string,
  body: Blob,
  params: UploadParams,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) => {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const uploadUrl = new URL(url);

    for (const key of Object.keys(params)) {
      uploadUrl.searchParams.append(key, String(params[key]));
    }

    signal.addEventListener("abort", () => xhr.abort());

    xhr.open("POST", uploadUrl.href, true);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.responseType = "json";

    xhr.upload.onprogress = (event) =>
      event.lengthComputable && onProgress((event.loaded / event.total) * 100);

    xhr.onload = () => {
      onProgress(100);
      resolve(xhr.response as T);
    };

    xhr.onabort = () => {
      reject(new Error("upload aborted"));
    };
    xhr.onerror = () => {
      reject(new Error("upload failed"));
    };
    xhr.send(body);
  });
};

export const uploadFile = async (
  file: File,
  path: string,
  chunkSize: number,
  userId: number,
  concurrency: number,
  retries: number,
  retryDelay: number,
  encyptFile: boolean,
  randomChunking: boolean,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  onChunksCompleted: (chunks: number) => void,
  onCreate: (payload: components["schemas"]["File"]) => Promise<void>,
  skipCheck = false,
) => {
  const fileName = file.name;

  if (!skipCheck) {
    const res = (
      await fetchClient.GET("/files", {
        params: {
          query: { path, name: fileName, operation: "find" },
        },
      })
    ).data;

    if (res && res.items.length > 0) {
      throw Error("file exists");
    }
  }

  const totalParts = Math.ceil(file.size / chunkSize);

  const limit = pLimit(concurrency);

  const hashFn = await getMd5Hash();
  const uploadId = hashFn(
    `${path}/${fileName}${file.size.toString()}${formatTime(file.lastModified)}${userId}`,
  );

  const url = `${window.location.origin}/api/uploads/${uploadId}`;

  const uploadedParts = (
    await fetchClient.GET("/uploads/{id}", {
      params: {
        path: {
          id: uploadId,
        },
      },
    })
  ).data!;

  let channelId = 0;

  if (uploadedParts.length > 0) {
    channelId = uploadedParts[0].channelId;
  }

  const partUploadPromises: Promise<components["schemas"]["UploadPart"]>[] = [];

  const partProgress: number[] = [];

  for (let partIndex = 0; partIndex < totalParts; partIndex++) {
    if (
      uploadedParts?.findIndex((item) => item.partNo === partIndex + 1) > -1
    ) {
      partProgress[partIndex] = 100;
      continue;
    }

    partUploadPromises.push(
      limit(() =>
        (async () => {
          const start = partIndex * chunkSize;

          const end = Math.min(partIndex * chunkSize + chunkSize, file.size);

          const fileBlob = totalParts > 1 ? file.slice(start, end) : file;

          const hashFn = await getMd5Hash();
          const partName = randomChunking
            ? hashFn(generateUUID())
            : totalParts > 1
              ? `${fileName}.part.${zeroPad(partIndex + 1, 3)}`
              : fileName;

          const params = {
            partName,
            fileName,
            partNo: partIndex + 1,
            encrypted: encyptFile,
            channelId,
          } as const;

          let retryCount = 0;
          let asset: components["schemas"]["UploadPart"] | null = null;

          while (retryCount <= retries) {
            try {
              asset = await uploadChunk<components["schemas"]["UploadPart"]>(
                url,
                fileBlob,
                params,
                signal,
                (progress) => {
                  partProgress[partIndex] = progress;
                },
              );
              break;
            } catch (error) {
              if (signal.aborted || retryCount === retries) {
                throw error;
              }
              retryCount++;
              partProgress[partIndex] = 0;
              await new Promise((resolve) =>
                setTimeout(resolve, retryDelay * retryCount),
              );
            }
          }

          return asset!;
        })(),
      ),
    );
  }

  const timer = setInterval(() => {
    const totalProgress = partProgress.reduce(
      (sum, progress) => sum + progress,
      0,
    );
    onProgress(totalParts > 0 ? totalProgress / totalParts : 0);

    const completedChunks = partProgress.filter((p) => p === 100).length;
    onChunksCompleted(completedChunks);
  }, 200);

  signal.addEventListener("abort", () => {
    limit.clearQueue();
    clearInterval(timer);
  });

  try {
    const parts = await Promise.all(partUploadPromises);

    const uploadParts = uploadedParts
      .concat(parts)
      .sort((a, b) => a.partNo - b.partNo)
      .map((item) => ({ id: item.partId, salt: item.salt }));

    const payload = {
      name: fileName,
      mimeType: file.type ?? "application/octet-stream",
      type: "file",
      parts: uploadParts,
      size: file.size,
      path: path ? path : "/",
      encrypted: encyptFile,
      channelId,
    } as const;

    await onCreate(payload);
    await fetchClient.DELETE("/uploads/{id}", {
      params: {
        path: {
          id: uploadId,
        },
      },
    });
    clearInterval(timer);
  } catch (error) {
    clearInterval(timer);
    throw error;
  }
};
