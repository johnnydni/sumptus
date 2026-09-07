/**
 * Turning a picked photo into something that fits in local storage.
 *
 * This matters more than it looks. The whole app state lives in one
 * localStorage entry with a browser budget of roughly 5 MB, and a phone photo
 * is 3–8 MB before base64 inflates it by another third. Storing what the file
 * picker hands over would blow the quota on the first upload and silently lose
 * every expense with it. So nothing reaches the store until it has been
 * redrawn at a sane size and re-encoded.
 */

export interface CompressOptions {
  /** Longest edge of the result, in CSS pixels. */
  maxDimension: number
  /** Starting JPEG quality; dropped in steps if the result is still too big. */
  quality?: number
  /** Hard ceiling for the encoded data URL, in bytes. */
  maxBytes?: number
}

export const COVER_IMAGE: CompressOptions = {
  maxDimension: 1280,
  quality: 0.82,
  maxBytes: 400_000,
}

/**
 * Where a header photo sits in its frame when nobody has repositioned it, as a
 * CSS `object-position` percentage: the middle.
 */
export const DEFAULT_COVER_OFFSET = 50

export const AVATAR_IMAGE: CompressOptions = {
  maxDimension: 320,
  quality: 0.85,
  maxBytes: 60_000,
}

export class ImageError extends Error {}

/** Decode a file into something drawable, with a fallback for older Safari. */
async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through to the <img> path rather than failing the upload.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new ImageError('That file could not be read as an image.'))
      image.src = url
    })
  } finally {
    // Revoking immediately is safe: decoding has finished or failed by now.
    URL.revokeObjectURL(url)
  }
}

/**
 * Read a picked file and return a JPEG data URL small enough to persist.
 *
 * Throws ImageError with a message worth showing the user — callers surface it
 * inline rather than swallowing it, because a silently ignored upload is worse
 * than a rejected one.
 */
export async function compressImage(file: File, options: CompressOptions): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new ImageError('Pick an image file.')
  }

  const source = await decode(file)
  const { maxDimension, quality = 0.82, maxBytes = 400_000 } = options

  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new ImageError('This browser could not process the image.')

  // JPEG has no alpha; without a white ground a transparent PNG turns black.
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)

  if ('close' in source && typeof source.close === 'function') source.close()

  // Step the quality down until it fits. Four attempts is enough to bring any
  // realistic photo under the ceiling without visibly destroying it.
  let result = canvas.toDataURL('image/jpeg', quality)
  for (let step = 1; step <= 3 && result.length > maxBytes; step += 1) {
    result = canvas.toDataURL('image/jpeg', Math.max(0.4, quality - step * 0.15))
  }

  if (result.length > maxBytes) {
    throw new ImageError('That image is too large. Try a smaller one.')
  }

  return result
}
