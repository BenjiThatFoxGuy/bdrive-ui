import clsx from "clsx";
import { memo } from "react";

import { type PassField, formatFieldValue, textAlignClass } from "@/utils/pkpass";

interface PassFieldGroupProps {
  fields?: PassField[];
  labelColor: string;
  variant?: PassFieldVariant;
  align?: string;
  className?: string;
}

export const PassFieldGroup = memo(function PassFieldGroup({
  fields,
  labelColor,
  variant = "secondary",
  align = "text-left",
  className,
}: PassFieldGroupProps) {
  if (!fields?.length) return null;

  return (
    <div className={clsx("flex min-w-0 gap-4", className)}>
      {fields.map((field) => (
        <div
          key={field.key}
          className={clsx(
            "min-w-0",
            variant === "header" ? "shrink-0" : "flex-1",
            textAlignClass(field, align),
          )}
        >
          {field.label && (
            <p
              className="truncate text-label-small uppercase tracking-wider"
              style={{ color: labelColor }}
            >
              {field.label}
            </p>
          )}
          <p className={clsx("truncate", valueClasses[variant])}>{formatFieldValue(field)}</p>
        </div>
      ))}
    </div>
  );
});

// The back of a pass is a plain list rather than a row, and its values are
// often long enough that truncating them would lose the point.
export const PassBackFields = memo(function PassBackFields({
  fields,
  labelColor,
}: {
  fields?: PassField[];
  labelColor: string;
}) {
  if (!fields?.length)
    return <p className="text-body-medium opacity-70">This pass has no additional details.</p>;

  return (
    <dl className="flex flex-col gap-4">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          {field.label && (
            <dt className="text-label-small uppercase tracking-wider" style={{ color: labelColor }}>
              {field.label}
            </dt>
          )}
          <dd className="whitespace-pre-wrap break-words text-body-medium">
            {formatFieldValue(field)}
          </dd>
        </div>
      ))}
    </dl>
  );
});

const valueClasses = {
  header: "text-label-large font-medium",
  primary: "text-headline-small font-medium",
  secondary: "text-body-medium font-medium",
} as const;

type PassFieldVariant = keyof typeof valueClasses;
