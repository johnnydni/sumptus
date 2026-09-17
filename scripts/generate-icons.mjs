/**
 * Renders the PWA icon set and the favicon from the brand mark.
 *
 * The mark is a raster, so it is box-filtered down to each icon size rather
 * than point-sampled — the thin waist of the crescent and the two punched
 * holes are exactly what naive downscaling loses first.
 *
 * Run with: node scripts/generate-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeRgba, encodeRgba, resampleAlpha } from './png.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARK = resolve(root, 'brand/mark-source.png')

const INK = [17, 17, 17]
const NAVY = [23, 42, 70]
const WHITE = [255, 255, 255]

const source = decodeRgba(MARK)
const ASPECT = source.width / source.height

/**
 * Compose one icon: a rounded (or full-bleed) sheet with the mark centred on
 * it, sized as a fraction of the canvas.
 */
function render(size, { background, foreground, radius, markHeight, markOnly = false }) {
  const buffer = Buffer.alloc(size * size * 4)

  const mh = Math.round(size * markHeight)
  const mw = Math.round(mh * ASPECT)
  const mark = resampleAlpha(source, mw, mh)
  const offsetX = Math.round((size - mw) / 2)
  const offsetY = Math.round((size - mh) / 2)

  // Rounded-rect coverage, supersampled 3×3 so the corners are not stepped.
  const samples = 3
  const step = 1 / samples
  const inSheet = (x, y) => {
    if (radius <= 0) return true
    const cx = Math.min(Math.max(x, radius), size - radius)
    const cy = Math.min(Math.max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
  }

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let covered = 0
      if (!markOnly) {
        for (let sy = 0; sy < samples; sy += 1) {
          for (let sx = 0; sx < samples; sx += 1) {
            if (inSheet(px + (sx + 0.5) * step, py + (sy + 0.5) * step)) covered += 1
          }
        }
      }
      const sheet = covered / (samples * samples)

      const mx = px - offsetX
      const my = py - offsetY
      const ink = mx >= 0 && mx < mw && my >= 0 && my < mh ? mark[my * mw + mx] : 0

      const alpha = Math.max(sheet, ink)
      const mix = alpha === 0 ? 0 : ink / alpha
      const offset = (py * size + px) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        buffer[offset + channel] = Math.round(
          background[channel] * (1 - mix) + foreground[channel] * mix,
        )
      }
      buffer[offset + 3] = Math.round(alpha * 255)
    }
  }

  return buffer
}

function write(path, size, options) {
  const full = resolve(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, encodeRgba(size, size, render(size, options)))
  console.log(`wrote ${path} (${size}×${size})`)
}

// Standard icons: white sheet, ink mark — the app's own canvas.
for (const size of [192, 512]) {
  write(`public/icons/icon-${size}.png`, size, {
    background: WHITE,
    foreground: INK,
    radius: size * 0.22,
    markHeight: 0.54,
  })
}

// A favicon is read at 16px in a tab strip, so the mark gets more of the
// canvas and the sheet loses its corners.
write('public/icons/favicon.png', 64, {
  background: WHITE,
  foreground: INK,
  radius: 64 * 0.16,
  markHeight: 0.66,
})

/*
 * Home screen, iOS.
 *
 * Three rules that differ from the icons above.
 *
 * It must be opaque and square: iOS composites an apple-touch-icon onto black
 * and rounds it itself, so transparent corners come back as black ones. And it
 * wants 180×180 — handing it the 192 the manifest uses only makes the device
 * rescale.
 *
 * And it is inverted: a navy sheet with a white mark, where every other icon
 * here is the app's own white canvas. That is not a second opinion about the
 * brand, it is what the home screen does with it. iOS renders a legacy flat
 * icon in its transparent and tinted appearances by reading brightness as
 * material — bright becomes glass, dark becomes empty. A white sheet is 93% of
 * the tile at full brightness, so the whole square turns into one slab of glass
 * and the mark is left as a faint subtraction inside it, which is exactly how
 * it looked on a phone. Inverting puts the material where the mark is and
 * leaves the rest of the tile empty, which is the shape of every icon that
 * survives that treatment.
 *
 * Verify it the only way that counts: add the app to a home screen, then
 * switch the icon appearance to Clear or Tinted. A simulation of Apple's
 * compositing is a guess about someone else's renderer.
 */
write('public/icons/apple-touch-icon.png', 180, {
  background: NAVY,
  foreground: WHITE,
  radius: 0,
  markHeight: 0.54,
})

// Maskable: full-bleed navy, mark kept inside the safe zone platforms crop to.
write('public/icons/icon-512-maskable.png', 512, {
  background: NAVY,
  foreground: WHITE,
  radius: 0,
  markHeight: 0.42,
})

/*
 * Android's themed icons, which have the same problem and a proper answer for
 * it: the platform ignores colour here and keeps only the alpha channel, then
 * fills the shape with whatever the user's wallpaper suggests. So this one is
 * the mark alone on nothing — and it has to respect the maskable safe zone,
 * because the launcher crops it the same way.
 */
write('public/icons/icon-512-monochrome.png', 512, {
  background: WHITE,
  foreground: WHITE,
  radius: 0,
  markHeight: 0.42,
  markOnly: true,
})
