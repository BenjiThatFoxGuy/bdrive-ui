import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@tw-material/react";
import clsx from "clsx";
import { memo, useEffect, useMemo } from "react";
import IconErrorOutline from "~icons/material-symbols/error-outline";

import { center } from "@/utils/classes";
import fetch from "@/utils/fetch-throw";
import { PassError, type PassImageName, parsePass } from "@/utils/pkpass";
import PassCard from "./pass-card";

const PkPassPreview = ({ assetUrl }: { assetUrl: string }) => {
  const {
    data: parsed,
    error,
    isPending,
  } = useQuery({
    queryKey: ["pkpass", assetUrl],
    queryFn: async ({ signal }) => {
      const response = await fetch(assetUrl, { signal });
      return parsePass(await response.arrayBuffer());
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // The artwork is unzipped in memory, so it needs object URLs to reach <img>.
  const images = useMemo(() => {
    const urls: Partial<Record<PassImageName, string>> = {};
    for (const [name, blob] of Object.entries(parsed?.images ?? {}))
      urls[name as PassImageName] = URL.createObjectURL(blob);
    return urls;
  }, [parsed]);

  useEffect(
    () => () => {
      for (const url of Object.values(images)) URL.revokeObjectURL(url);
    },
    [images],
  );

  if (isPending) return <Spinner className={center} />;

  if (error)
    return (
      <div className={clsx(center, "flex max-w-sm flex-col items-center gap-3 text-center")}>
        <IconErrorOutline className="size-8 text-error" />
        <p className="text-body-medium">
          {error instanceof PassError ? error.message : "This pass couldn't be loaded."}
        </p>
      </div>
    );

  return (
    <div className="size-full overflow-y-auto px-2 py-4">
      <PassCard parsed={parsed} images={images} />
      <p className="mx-auto mt-3 max-w-sm text-center text-body-small text-on-surface-variant">
        Shown as stored. The pass signature isn't checked in the browser.
      </p>
    </div>
  );
};

export default memo(PkPassPreview);
