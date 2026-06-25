import { Toaster as HotToaster, toast, resolveValue } from "react-hot-toast";
import IconMaterialSymbolsClose from "~icons/material-symbols/close";
import IconMaterialSymbolsCheckCircleRounded from "~icons/material-symbols/check-circle-rounded";
import IconMaterialSymbolsErrorRounded from "~icons/material-symbols/error-rounded";
import { Button, Spinner } from "@tw-material/react";
import clsx from "clsx";

// Toaster styling must match upload modal (src/components/upload/index.tsx) for UI consistency:
// - bg-surface-container-high (background)
// - border-outline-variant/10 (border color)
// - shadow-2xl (elevation)
// - rounded-xl (border radius)
// - text-on-surface (text color)
// When updating toasts, maintain this style throughout the app.
export function Toaster() {
  return (
    <HotToaster position="bottom-right">
      {(t) => (
        <div
          className={clsx(
            "flex items-center gap-3 pl-4 pr-2 py-2 min-h-[48px] border rounded-xl shadow-2xl transition-all duration-300 ease-in-out",
            "bg-surface-container-high border-outline-variant/10 text-on-surface",
            t.visible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-95",
          )}
        >
          <div className="flex-shrink-0 flex items-center justify-center size-6">
            {t.type === "success" && (
              <IconMaterialSymbolsCheckCircleRounded className="size-5 text-primary-fixed" />
            )}
            {t.type === "error" && (
              <IconMaterialSymbolsErrorRounded className="size-5 text-error" />
            )}
            {t.type === "loading" && <Spinner size="sm" />}
          </div>
          <div className="text-sm font-medium flex-grow pr-2 min-w-[200px]">
            {resolveValue(t.message, t)}
          </div>
          {t.type !== "loading" && (
            <Button
              isIconOnly
              variant="text"
              size="sm"
              className="text-on-surface-variant hover:bg-outline-variant/10 min-w-10"
              onPress={() => toast.dismiss(t.id)}
            >
              <IconMaterialSymbolsClose className="size-5" />
            </Button>
          )}
        </div>
      )}
    </HotToaster>
  );
}
