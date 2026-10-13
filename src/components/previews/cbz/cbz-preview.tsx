import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@tw-material/react"
import IconIcRoundNavigateBefore from "~icons/ic/round-navigate-before"
import IconIcRoundNavigateNext from "~icons/ic/round-navigate-next"
import IconIcRoundInfo from "~icons/ic/round-info"
import IconIcRoundClose from "~icons/ic/round-close"
import clsx from "clsx"

interface ComicPageInfo {
  image: number
  type?: string
  doublePage?: boolean
  imageSize?: number
  imageWidth?: number
  imageHeight?: number
}

interface ComicInfo {
  title?: string
  series?: string
  number?: string
  count?: number
  volume?: string
  summary?: string
  writer?: string
  penciller?: string
  inker?: string
  colorist?: string
  letterer?: string
  coverArtist?: string
  editor?: string
  publisher?: string
  year?: number
  month?: number
  day?: number
  genre?: string
  tags?: string
  languageISO?: string
  pageCount?: number
  manga?: string
  ageRating?: string
  pages?: { page?: ComicPageInfo[] }
}

interface MetadataResponse {
  comicInfo?: ComicInfo
  totalPages: number
}

interface CbzEntry {
  name: string
  path: string
  size: number
  isDir: boolean
  mimeType?: string
}

interface ListResponse {
  entries: CbzEntry[]
  total: number
}

function isImageFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tiff", "tif"].includes(ext)
}

function buildCbzUrl(fileId: string, action: string, params?: Record<string, string>): string {
  const url = new URL(window.location.origin)
  url.pathname = `/api/files/cbz/${fileId}/${action}`
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }
  return url.toString()
}

export default memo(function CbzPreview({ fileId, sessionHash }: { fileId: string; sessionHash: string }) {
  const [pages, setPages] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [metadata, setMetadata] = useState<ComicInfo | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch the file listing and metadata on mount.
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [listRes, metaRes] = await Promise.all([
          fetch(buildCbzUrl(fileId, "list", { path: "/", hash: sessionHash })),
          fetch(buildCbzUrl(fileId, "metadata", { hash: sessionHash })),
        ])

        if (!listRes.ok) throw new Error("Failed to load comic pages")

        const listData: ListResponse = await listRes.json()
        const imageEntries = listData.entries
          .filter((e) => !e.isDir && isImageFile(e.name))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))

        if (cancelled) return

        setPages(imageEntries.map((e) => e.path))

        if (metaRes.ok) {
          const metaData: MetadataResponse = await metaRes.json()
          if (metaData.comicInfo) {
            setMetadata(metaData.comicInfo)
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load comic")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [fileId, sessionHash])

  // Keyboard navigation.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault()
        setCurrentPage((p) => Math.min(p + 1, pages.length - 1))
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        setCurrentPage((p) => Math.max(p - 1, 0))
      } else if (e.key === "Home") {
        e.preventDefault()
        setCurrentPage(0)
      } else if (e.key === "End") {
        e.preventDefault()
        setCurrentPage(pages.length - 1)
      }
    }

    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [pages.length])

  const pageUrl = useMemo(() => {
    if (pages.length === 0) return ""
    return buildCbzUrl(fileId, "file", { path: pages[currentPage], hash: sessionHash })
  }, [fileId, sessionHash, pages, currentPage])

  const goNext = useCallback(() => setCurrentPage((p) => Math.min(p + 1, pages.length - 1)), [pages.length])
  const goPrev = useCallback(() => setCurrentPage((p) => Math.max(p - 1, 0)), [pages.length])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-on-surface-variant">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-error">
        <p>{error}</p>
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-on-surface-variant">
        <p>No pages found in this comic.</p>
      </div>
    )
  }

  const isRtl = metadata?.manga === "YesAndRightToLeft"

  return (
    <div className="relative flex flex-col items-center w-full h-full select-none">
      {/* Page image */}
      <div className="flex-1 flex items-center justify-center w-full overflow-hidden min-h-0">
        <img
          src={pageUrl}
          alt={`Page ${currentPage + 1}`}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-2 py-2 px-4 bg-surface-container/80 backdrop-blur-sm rounded-t-xl">
        <Button
          className="text-on-surface size-8 min-w-8 px-0"
          variant="text"
          isDisabled={isRtl ? currentPage >= pages.length - 1 : currentPage <= 0}
          onPress={isRtl ? goNext : goPrev}
        >
          <IconIcRoundNavigateBefore />
        </Button>

        <span className="text-on-surface-variant text-sm tabular-nums min-w-[4rem] text-center">
          {currentPage + 1} / {pages.length}
        </span>

        <Button
          className="text-on-surface size-8 min-w-8 px-0"
          variant="text"
          isDisabled={isRtl ? currentPage <= 0 : currentPage >= pages.length - 1}
          onPress={isRtl ? goPrev : goNext}
        >
          <IconIcRoundNavigateNext />
        </Button>

        {metadata && (
          <Button
            className="text-on-surface size-8 min-w-8 px-0 ml-2"
            variant="text"
            onPress={() => setShowInfo((s) => !s)}
          >
            <IconIcRoundInfo />
          </Button>
        )}
      </div>

      {/* Info panel */}
      {showInfo && metadata && (
        <div
          className={clsx(
            "absolute right-0 top-0 bottom-0 w-80 max-w-full",
            "bg-surface-container/95 backdrop-blur-md",
            "border-l border-outline-variant",
            "overflow-y-auto p-4 z-10",
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-on-surface font-medium text-lg">Comic Info</h3>
            <Button
              className="text-on-surface size-8 min-w-8 px-0"
              variant="text"
              onPress={() => setShowInfo(false)}
            >
              <IconIcRoundClose />
            </Button>
          </div>

          <div className="space-y-3 text-sm">
            <InfoField label="Title" value={metadata.title} />
            <InfoField label="Series" value={metadata.series} />
            <InfoField label="Number" value={metadata.number} />
            {metadata.count ? <InfoField label="Count" value={String(metadata.count)} /> : null}
            <InfoField label="Volume" value={metadata.volume} />
            <InfoField label="Writer" value={metadata.writer} />
            <InfoField label="Penciller" value={metadata.penciller} />
            <InfoField label="Inker" value={metadata.inker} />
            <InfoField label="Colorist" value={metadata.colorist} />
            <InfoField label="Letterer" value={metadata.letterer} />
            <InfoField label="Cover Artist" value={metadata.coverArtist} />
            <InfoField label="Editor" value={metadata.editor} />
            <InfoField label="Publisher" value={metadata.publisher} />
            {metadata.year ? (
              <InfoField
                label="Date"
                value={[metadata.year, metadata.month, metadata.day].filter(Boolean).join("-")}
              />
            ) : null}
            <InfoField label="Genre" value={metadata.genre} />
            <InfoField label="Tags" value={metadata.tags} />
            <InfoField label="Language" value={metadata.languageISO} />
            <InfoField label="Age Rating" value={metadata.ageRating} />
            <InfoField label="Manga" value={metadata.manga} />
            {metadata.summary ? (
              <div>
                <span className="text-on-surface-variant font-medium">Summary</span>
                <p className="text-on-surface mt-1 whitespace-pre-line">{metadata.summary}</p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
})

function InfoField({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <span className="text-on-surface-variant font-medium">{label}: </span>
      <span className="text-on-surface">{value}</span>
    </div>
  )
}
