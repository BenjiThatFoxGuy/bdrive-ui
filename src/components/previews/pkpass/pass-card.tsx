import { Button } from "@tw-material/react";
import clsx from "clsx";
import { memo } from "react";
import { useToggle } from "usehooks-ts";
import IconArrowRight from "~icons/material-symbols/arrow-right-alt";
import IconBlock from "~icons/material-symbols/block";
import IconClose from "~icons/material-symbols/close-rounded";
import IconBoat from "~icons/material-symbols/directions-boat";
import IconBus from "~icons/material-symbols/directions-bus";
import IconFlight from "~icons/material-symbols/flight";
import IconMore from "~icons/material-symbols/more-horiz";
import IconTrain from "~icons/material-symbols/train";

import {
  type ParsedPass,
  type PassImageName,
  type PassStructure,
  type PassStyle,
  barcodeOf,
  cssColor,
  isExpired,
  passFields,
} from "@/utils/pkpass";
import PassBarcodeView from "./pass-barcode";
import { PassBackFields, PassFieldGroup } from "./pass-fields";

type ImageUrls = Partial<Record<PassImageName, string>>;

interface PassCardProps {
  parsed: ParsedPass;
  images: ImageUrls;
}

const PassCard = ({ parsed, images }: PassCardProps) => {
  const [flipped, toggleFlipped] = useToggle(false);

  const { pass, style } = parsed;
  const structure = passFields(pass, style);
  const barcode = barcodeOf(pass);

  const background = cssColor(pass.backgroundColor, "rgb(60,65,76)");
  const foreground = cssColor(pass.foregroundColor, "rgb(255,255,255)");
  const labelColor = cssColor(pass.labelColor, foreground);

  const expired = isExpired(pass);

  return (
    <div
      className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl shadow-2xl"
      style={{ backgroundColor: background, color: foreground }}
    >
      <div className="flex items-center gap-3 px-4 pt-4">
        {images.logo ? (
          <img src={images.logo} alt="" className="max-h-9 max-w-40 object-contain" />
        ) : (
          <p className="truncate text-label-large font-medium">
            {pass.logoText || pass.organizationName}
          </p>
        )}
        {images.logo && pass.logoText && (
          <p className="truncate text-label-large font-medium">{pass.logoText}</p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!flipped && (
            <PassFieldGroup
              fields={structure.headerFields}
              labelColor={labelColor}
              variant="header"
              align="text-right"
            />
          )}
          <Button
            isIconOnly
            variant="text"
            size="sm"
            aria-label={flipped ? "Show pass front" : "Show pass details"}
            className="text-inherit"
            onPress={toggleFlipped}
          >
            {flipped ? <IconClose /> : <IconMore />}
          </Button>
        </div>
      </div>

      {(pass.voided || expired) && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-black/25 px-3 py-2 text-label-medium">
          <IconBlock className="size-4 shrink-0" />
          {pass.voided ? "This pass has been voided." : "This pass has expired."}
        </div>
      )}

      {flipped ? (
        <div className="px-4 py-4">
          <PassBackFields fields={structure.backFields} labelColor={labelColor} />
        </div>
      ) : (
        <>
          <PassBody style={style} structure={structure} images={images} labelColor={labelColor} />
          {images.footer && (
            <img src={images.footer} alt="" className="mx-auto mt-2 max-h-14 object-contain" />
          )}
          {barcode && (
            <div className="px-4 pb-4 pt-3">
              <PassBarcodeView barcode={barcode} />
            </div>
          )}
        </>
      )}

      {pass.description && (
        <p className="truncate px-4 pb-3 text-label-small opacity-70">{pass.description}</p>
      )}
    </div>
  );
};

interface PassBodyProps {
  style: PassStyle;
  structure: PassStructure;
  images: ImageUrls;
  labelColor: string;
}

function PassBody({ style, structure, images, labelColor }: PassBodyProps) {
  if (style === "boardingPass")
    return <BoardingPassBody structure={structure} labelColor={labelColor} />;

  if (style === "coupon" || style === "storeCard")
    return <StripBody structure={structure} images={images} labelColor={labelColor} />;

  if (style === "eventTicket" && images.strip)
    return <StripBody structure={structure} images={images} labelColor={labelColor} />;

  return <ThumbnailBody structure={structure} images={images} labelColor={labelColor} />;
}

// Boarding passes read as origin, transit mode, destination.
function BoardingPassBody({
  structure,
  labelColor,
}: {
  structure: PassStructure;
  labelColor: string;
}) {
  const primary = structure.primaryFields ?? [];
  const TransitIcon =
    TRANSIT_ICONS[structure.transitType as keyof typeof TRANSIT_ICONS] ?? IconArrowRight;

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {primary.length === 2 ? (
        <div className="flex items-center gap-3">
          <PassFieldGroup fields={[primary[0]]} labelColor={labelColor} variant="primary" />
          <TransitIcon className="size-6 shrink-0 opacity-80" />
          <PassFieldGroup
            fields={[primary[1]]}
            labelColor={labelColor}
            variant="primary"
            align="text-right"
          />
        </div>
      ) : (
        <PassFieldGroup fields={primary} labelColor={labelColor} variant="primary" />
      )}
      <PassFieldGroup fields={structure.auxiliaryFields} labelColor={labelColor} />
      <PassFieldGroup fields={structure.secondaryFields} labelColor={labelColor} />
    </div>
  );
}

// Coupons, store cards and strip-backed event tickets put the primary fields
// on top of the full-width strip artwork.
function StripBody({
  structure,
  images,
  labelColor,
}: {
  structure: PassStructure;
  images: ImageUrls;
  labelColor: string;
}) {
  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className={clsx("relative mt-3", !images.strip && "px-4")}>
        {images.strip && <img src={images.strip} alt="" className="w-full object-cover" />}
        <div
          className={clsx(
            images.strip &&
              "absolute inset-0 flex items-end bg-gradient-to-t from-black/50 px-4 py-3",
          )}
        >
          <PassFieldGroup
            fields={structure.primaryFields}
            labelColor={images.strip ? "rgb(255,255,255)" : labelColor}
            variant="primary"
            className={clsx("w-full", images.strip && "text-white")}
          />
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4">
        <PassFieldGroup fields={structure.secondaryFields} labelColor={labelColor} />
        <PassFieldGroup fields={structure.auxiliaryFields} labelColor={labelColor} />
      </div>
    </div>
  );
}

// Generic passes and event tickets without a strip sit the thumbnail beside
// the primary fields.
function ThumbnailBody({
  structure,
  images,
  labelColor,
}: {
  structure: PassStructure;
  images: ImageUrls;
  labelColor: string;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex items-start gap-3">
        <PassFieldGroup
          fields={structure.primaryFields}
          labelColor={labelColor}
          variant="primary"
          className="grow"
        />
        {images.thumbnail && (
          <img src={images.thumbnail} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
        )}
      </div>
      <PassFieldGroup fields={structure.secondaryFields} labelColor={labelColor} />
      <PassFieldGroup fields={structure.auxiliaryFields} labelColor={labelColor} />
    </div>
  );
}

const TRANSIT_ICONS = {
  PKTransitTypeAir: IconFlight,
  PKTransitTypeBoat: IconBoat,
  PKTransitTypeBus: IconBus,
  PKTransitTypeTrain: IconTrain,
  PKTransitTypeGeneric: IconArrowRight,
} as const;

export default memo(PassCard);
