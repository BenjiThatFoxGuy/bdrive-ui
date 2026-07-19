import { memo, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Switch } from "@tw-material/react";
import clsx from "clsx";
import toast from "react-hot-toast";

import MdiFileMultipleOutline from "~icons/mdi/file-multiple-outline";
import MaterialSymbolsPlayArrowRounded from "~icons/material-symbols/play-arrow-rounded";
import MaterialSymbolsCleaningServicesOutline from "~icons/material-symbols/cleaning-services-outline";

import { $api } from "@/utils/api";
import { scrollbarClasses } from "@/utils/classes";
import type { components } from "@/lib/api";
import { NetworkError } from "@/utils/fetch-throw";

type DedupJob = components["schemas"]["DedupJob"];

const terminal = (status?: string) =>
  status === "completed" || status === "failed";

const StatTile = memo(
  ({ label, value }: { label: string; value: number | string }) => (
    <div className="flex flex-col gap-1 rounded-2xl bg-surface-container p-4">
      <span className="text-3xl font-bold text-primary tabular-nums">
        {value}
      </span>
      <span className="text-sm text-on-surface-variant">{label}</span>
    </div>
  ),
);

const phaseLabel: Record<string, string> = {
  loading: "Loading files",
  backfilling: "Backfilling hashes",
  grouping: "Grouping by hash",
  linking: "Linking duplicates",
  done: "Finishing up",
};

const ProgressSection = memo(
  ({ progress }: { progress: NonNullable<DedupJob["progress"]> }) => {
    const { phase, current, total } = progress;
    const determinate = total > 0;
    const percent = determinate
      ? Math.min(100, Math.round((current / total) * 100))
      : 0;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-on-surface-variant">
            {phaseLabel[phase] ?? phase}
          </span>
          {determinate && (
            <span className="tabular-nums text-on-surface-variant">
              {current} / {total} ({percent}%)
            </span>
          )}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className={clsx(
              "h-full rounded-full bg-primary transition-[width] duration-500 ease-out",
              determinate ? "" : "w-1/3 animate-pulse",
            )}
            style={determinate ? { width: `${percent}%` } : undefined}
          />
        </div>
      </div>
    );
  },
);

const statusChip = (status: DedupJob["status"]) => {
  const map: Record<DedupJob["status"], string> = {
    pending: "bg-secondary-container text-on-secondary-container",
    running: "bg-secondary-container text-on-secondary-container",
    completed: "bg-primary-container text-on-primary-container",
    failed: "bg-error-container text-on-error-container",
  };
  return (
    <span
      className={clsx(
        "text-xs px-2 py-0.5 rounded-full font-medium capitalize",
        map[status],
      )}
    >
      {status}
    </span>
  );
};

export const DeduplicationTab = memo(() => {
  const queryClient = useQueryClient();

  // Default to dry-run so the first click never mutates anything unexpectedly.
  const [dryRun, setDryRun] = useState(true);
  const [backfill, setBackfill] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: stats } = $api.useQuery("get", "/dedup/stats");

  const startJob = $api.useMutation("post", "/dedup/jobs", {
    onSuccess: (job) => {
      setActiveJobId(job.id);
      toast.success(dryRun ? "Dry run started" : "Deduplication started");
    },
    onError: async (error) => {
      if (error instanceof NetworkError) {
        const data =
          (await error.data?.json()) as components["schemas"]["Error"];
        toast.error(data.message.split(":").slice(-1)[0]!.trim());
      } else {
        toast.error("Failed to start deduplication");
      }
    },
  });

  const { data: job } = $api.useQuery(
    "get",
    "/dedup/jobs/{id}",
    { params: { path: { id: activeJobId ?? "" } } },
    {
      enabled: !!activeJobId,
      refetchInterval: (query) =>
        terminal((query.state.data as DedupJob | undefined)?.status)
          ? false
          : 1500,
    },
  );

  // When a run finishes, refresh the standing stats card.
  useEffect(() => {
    if (job && terminal(job.status)) {
      queryClient.invalidateQueries({
        queryKey: $api.queryOptions("get", "/dedup/stats").queryKey,
      });
    }
  }, [job?.status]);

  const isRunning =
    startJob.isPending || (!!job && !terminal(job.status) && !!activeJobId);

  const run = useCallback(() => {
    startJob.mutate({ body: { dryRun, backfill, allUsers: false } });
  }, [dryRun, backfill, startJob]);

  return (
    <div
      className={clsx(
        "flex flex-col gap-6 p-4 w-full h-full overflow-y-auto",
        scrollbarClasses,
      )}
    >
      {/* Current state */}
      <div className="bg-surface-container-low rounded-3xl p-6 border border-outline-variant/50">
        <div className="flex items-start gap-4 mb-6">
          <div className="p-3 rounded-2xl bg-secondary-container text-on-secondary-container">
            <MdiFileMultipleOutline className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-semibold mb-1">Deduplication</h3>
            <p className="text-sm text-on-surface-variant">
              BDrive links files with identical content to a single copy so your
              Telegram storage isn't holding duplicates. This runs over{" "}
              <span className="font-medium">your own files</span>.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <StatTile
            label="Duplicate groups"
            value={stats?.duplicateGroups ?? 0}
          />
          <StatTile label="Files linked" value={stats?.totalFilesLinked ?? 0} />
        </div>
      </div>

      {/* Run panel */}
      <div className="bg-surface-container-low rounded-3xl p-6 border border-outline-variant/50 flex flex-col gap-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-secondary-container text-on-secondary-container">
            <MaterialSymbolsCleaningServicesOutline className="size-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-semibold mb-1">Run deduplication</h3>
            <p className="text-sm text-on-surface-variant">
              Group your files by content hash and link duplicates to a single
              canonical copy.
            </p>
          </div>
        </div>

        <div className="flex flex-col divide-y divide-outline-variant/30">
          <div className="flex items-center justify-between py-4">
            <div className="flex flex-col pr-4">
              <span className="font-medium">Dry run</span>
              <span className="text-sm text-on-surface-variant">
                Preview what would change without writing anything.
              </span>
            </div>
            <Switch
              size="lg"
              isSelected={dryRun}
              onValueChange={setDryRun}
              isDisabled={isRunning}
              aria-label="Dry run"
            />
          </div>
          <div className="flex items-center justify-between py-4">
            <div className="flex flex-col pr-4">
              <span className="font-medium">Backfill missing hashes</span>
              <span className="text-sm text-on-surface-variant">
                Compute hashes for older files first by re-reading their content
                from Telegram. Slower.
              </span>
            </div>
            <Switch
              size="lg"
              isSelected={backfill}
              onValueChange={setBackfill}
              isDisabled={isRunning}
              aria-label="Backfill missing hashes"
            />
          </div>
        </div>

        <Button
          variant="filled"
          className="self-start px-6"
          startContent={
            !isRunning && <MaterialSymbolsPlayArrowRounded className="size-5" />
          }
          isLoading={isRunning}
          isDisabled={isRunning}
          onPress={run}
        >
          {isRunning ? "Running" : dryRun ? "Start dry run" : "Run"}
        </Button>

        {/* Job progress / result */}
        {job && (
          <div className="rounded-2xl bg-surface-container p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {job.options.dryRun ? "Dry run" : "Deduplication"}
              </span>
              {statusChip(job.status)}
            </div>
            {!terminal(job.status) && job.progress && (
              <ProgressSection progress={job.progress} />
            )}
            {job.status === "failed" && job.error && (
              <p className="text-sm text-error">{job.error}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile
                label="Duplicate groups"
                value={job.stats.duplicateGroups}
              />
              <StatTile label="Files linked" value={job.stats.totalFilesLinked} />
              <StatTile
                label="Hashes backfilled"
                value={job.stats.hashesBackfilled}
              />
              <StatTile label="Skipped" value={job.stats.skippedFiles} />
            </div>
            {job.status === "completed" && job.options.dryRun && (
              <p className="text-sm text-on-surface-variant">
                Nothing was written — turn off Dry run to apply these changes.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
