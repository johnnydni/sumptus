import { useCallback, useRef, useState } from 'react'
import { ImagePlus, Loader2, MoveVertical, RefreshCw, Trash2 } from 'lucide-react'
import { compressImage, COVER_IMAGE, DEFAULT_COVER_OFFSET, ImageError } from '@/lib/images'
import { cn } from '@/lib/cn'

interface CoverPickerProps {
  /** Current cover as a data URL, or undefined for none. */
  value?: string
  /** Which slice of the photo the frame shows, 0 (top) to 100 (bottom). */
  offset?: number
  onChange: (coverUrl: string | undefined) => void
  onOffsetChange?: (offset: number) => void
  /** Set to null where the surrounding sheet already carries the heading. */
  label?: string | null
  className?: string
}

/**
 * Pick, reposition, replace or remove a group's header photo.
 *
 * The file never reaches the store as-is — `compressImage` redraws and
 * re-encodes it first, and anything it rejects is reported inline rather than
 * dropped. Uploads that quietly do nothing are the worst version of this
 * control.
 *
 * The frame is a wide letterbox and phone photos are tall, so most of a picture
 * is outside it and which part survives is not a detail — it is the difference
 * between a header of the group and a header of somebody's chin. So the frame
 * is a drag surface: pull the photo up or down and the visible slice follows.
 * Only the offset is stored; the image itself is never re-cropped, so the
 * choice stays reversible and costs no second encode.
 */
export function CoverPicker({
  value,
  offset = DEFAULT_COVER_OFFSET,
  onChange,
  onOffsetChange,
  label = 'Header image',
  className,
}: CoverPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ pointerId: number; startY: number; startOffset: number; overflow: number }>()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  /*
   * Where the photo sits while the finger is down.
   *
   * The committed value goes through the store, and the store holds the photo
   * itself — a data URL of a few hundred kilobytes that is re-serialised on
   * every write. Sixty of those a second is the one way a drag could stutter,
   * so the gesture runs on local state and only its result is stored.
   */
  const [live, setLive] = useState<number>()
  /** How much of the photo hangs outside the frame; 0 means nothing to pan. */
  const [overflow, setOverflow] = useState(0)

  const shown = clamp(live ?? offset)
  const panning = live !== undefined
  const pannable = Boolean(value) && overflow > 1 && onOffsetChange !== undefined

  /*
   * The overflow has to come from the rendered image, not from the file: the
   * frame is responsive and `object-fit: cover` scales to whichever axis is
   * short, so the only honest number is measured after layout.
   */
  const measure = useCallback(() => {
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image || !image.naturalWidth || !image.naturalHeight) return 0
    const scale = Math.max(
      frame.clientWidth / image.naturalWidth,
      frame.clientHeight / image.naturalHeight,
    )
    const hidden = image.naturalHeight * scale - frame.clientHeight
    setOverflow(hidden)
    return hidden
  }, [])

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset immediately so picking the same file twice still fires a change.
    event.target.value = ''
    if (!file) return

    setBusy(true)
    setError(undefined)
    try {
      onChange(await compressImage(file, COVER_IMAGE))
      // A new photo is a new framing question; the old answer does not carry.
      onOffsetChange?.(DEFAULT_COVER_OFFSET)
      setLive(undefined)
      setOverflow(0)
    } catch (cause) {
      setError(cause instanceof ImageError ? cause.message : 'That image could not be processed.')
    } finally {
      setBusy(false)
    }
  }

  const nudge = (delta: number) => {
    if (!onOffsetChange) return
    onOffsetChange(clamp(offset + delta))
  }

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pannable || event.button !== 0) return
    const hidden = measure()
    if (hidden <= 1) return
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: offset,
      overflow: hidden,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setLive(offset)
  }

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    // Pulling the photo down uncovers its top, so the offset goes the other way.
    const moved = ((event.clientY - active.startY) / active.overflow) * 100
    setLive(clamp(active.startOffset - moved))
  }

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = undefined
    if (live !== undefined) onOffsetChange?.(live)
    setLive(undefined)
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        {label === null ? <span /> : <p className="eyebrow">{label}</p>}
        {value && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
            >
              <RefreshCw size={13} strokeWidth={1.75} />
              Replace
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(undefined)
                onOffsetChange?.(DEFAULT_COVER_OFFSET)
                setLive(undefined)
                setOverflow(0)
                setError(undefined)
              }}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-negative"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              Remove
            </button>
          </div>
        )}
      </div>

      {value ? (
        <div
          ref={frameRef}
          role={pannable ? 'slider' : undefined}
          tabIndex={pannable ? 0 : undefined}
          aria-label={pannable ? 'Header image position' : undefined}
          aria-valuemin={pannable ? 0 : undefined}
          aria-valuemax={pannable ? 100 : undefined}
          aria-valuenow={pannable ? Math.round(shown) : undefined}
          aria-valuetext={pannable ? `${Math.round(shown)}% from the top` : undefined}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onKeyDown={(event) => {
            if (!pannable) return
            const step = event.shiftKey ? 10 : 3
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              nudge(step)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              nudge(-step)
            }
          }}
          className={cn(
            'relative block h-40 w-full select-none overflow-hidden rounded-md border border-line outline-none transition-colors duration-micro sm:h-52',
            'focus-visible:border-ink/40',
            error && 'border-negative',
            pannable && (panning ? 'cursor-grabbing' : 'cursor-grab'),
          )}
          // The gesture is vertical and so is the page; without this the sheet
          // scrolls away underneath the finger instead of the photo moving.
          style={{ touchAction: pannable ? 'none' : undefined }}
        >
          <img
            ref={imageRef}
            src={value}
            alt=""
            draggable={false}
            onLoad={measure}
            className="h-full w-full object-cover"
            style={{ objectPosition: `50% ${shown}%` }}
          />

          {pannable && (
            <span
              className={cn(
                'pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-ink/55 to-transparent pb-2 pt-6 text-[12px] font-medium text-white transition-opacity duration-micro',
                panning && 'opacity-0',
              )}
            >
              <MoveVertical size={12} strokeWidth={2} />
              Drag to reposition
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="Add a header image"
          className={cn(
            'relative block h-40 w-full overflow-hidden rounded-md border bg-surface/40 transition-colors duration-micro sm:h-52',
            error ? 'border-negative' : 'border-line hover:border-ink/25 hover:bg-surface/60',
          )}
        >
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] font-medium text-muted">
            {busy ? (
              <Loader2 size={18} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <ImagePlus size={18} strokeWidth={1.5} />
            )}
            {busy ? 'Processing…' : 'Add a photo'}
          </span>
        </button>
      )}

      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={pick} />

      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-snug text-negative">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-snug text-muted">
          {pannable
            ? 'Drag the photo to choose what the header shows. Stored on this device.'
            : 'Stored on this device and scaled down to keep the app fast.'}
        </p>
      )}
    </div>
  )
}

function clamp(offset: number): number {
  return Math.min(100, Math.max(0, offset))
}
