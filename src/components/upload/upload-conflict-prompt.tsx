import { Button } from "@tw-material/react";
import clsx from "clsx";
import { memo } from "react";

import IcRoundErrorOutline from "~icons/ic/round-error-outline";

import type { ConflictAction } from "@/utils/stores";

interface UploadConflictPromptProps {
  fileName: string;
  // Number of files (including this one) currently waiting on a decision.
  awaitingCount: number;
  applyToAll: boolean;
  onApplyToAllChange: (value: boolean) => void;
  onResolve: (action: ConflictAction) => void;
}

const actionButtons: { action: ConflictAction; label: string; emphasis?: boolean }[] = [
  { action: "skip", label: "Skip" },
  { action: "rename", label: "Keep both" },
  { action: "overwrite", label: "Overwrite", emphasis: true },
  { action: "cancel", label: "Cancel all" },
];

export const UploadConflictPrompt = memo(function UploadConflictPrompt({
  fileName,
  awaitingCount,
  applyToAll,
  onApplyToAllChange,
  onResolve,
}: UploadConflictPromptProps) {
  return (
    <div className="border-t border-outline-variant/20 bg-error-container/20 px-4 py-3">
      <div className="flex items-start gap-3">
        <IcRoundErrorOutline className="size-5 shrink-0 text-error mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-label-large text-on-surface">
            A file named{" "}
            <span className="font-medium break-all" title={fileName}>
              “{fileName}”
            </span>{" "}
            already exists here.
          </p>
          <p className="text-body-small text-on-surface-variant mt-0.5">
            Choose what to do with this upload.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {actionButtons.map(({ action, label, emphasis }) => (
          <Button
            key={action}
            size="sm"
            variant={emphasis ? "filled" : "filledTonal"}
            className={clsx(
              "justify-center",
              action === "cancel" && "text-error",
            )}
            onPress={() => onResolve(action)}
          >
            {label}
          </Button>
        ))}
      </div>

      {awaitingCount > 1 && (
        <label className="mt-3 flex cursor-pointer select-none items-center gap-2 text-body-small text-on-surface-variant">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={applyToAll}
            onChange={(e) => onApplyToAllChange(e.target.checked)}
          />
          Apply to all {awaitingCount} remaining conflicts
        </label>
      )}
    </div>
  );
});
