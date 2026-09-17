import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Where the app will be served from.
 *
 * GitHub Pages puts a project site under https://<user>.github.io/<repo>/, so
 * the production build has to carry that sub-path in every asset URL. The dev
 * server has no such prefix and must stay at "/" — otherwise `npm run dev`
 * answers 404 for every URL that isn't /<repo>/..., which looks exactly like a
 * missing index.html.
 *
 * The deploy workflow sets BASE_PATH explicitly; set it to "/" for a custom
 * domain, where the site is served from the root.
 */

/**
 * The GitHub repository name, which is what Pages puts in the URL.
 *
 * Not the product name — the app is called sumptus and the repository is not,
 * yet. The deploy workflow reads the real name from GitHub, so this only backs
 * a production build run by hand; change it when the repository is renamed and
 * the local build will match the live one again.
 */
const REPO = 'sumptus'

function resolveBase(command: 'serve' | 'build'): string {
  if (process.env.BASE_PATH) return process.env.BASE_PATH
  return command === 'serve' ? '/' : `/${REPO}/`
}

/**
 * GitHub Pages has no SPA rewrite. Shipping a byte-identical 404.html means a
 * deep link like /sumptus/groups/japan-trip is answered with the app shell,
 * which then routes client-side. No redirect hop, no flash.
 */
function spaFallback() {
  return {
    name: 'sumptus-spa-fallback',
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist')
      const index = path.join(dist, 'index.html')
      if (fs.existsSync(index)) {
        fs.copyFileSync(index, path.join(dist, '404.html'))
      }
    },
  }
}

export default defineConfig(({ command }) => {
  const base = resolveBase(command)

  return {
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'sumptus',
        short_name: 'sumptus',
        description: 'Shared expenses. Simply.',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          // Android's themed icons: the launcher keeps the alpha and recolours
          // the rest, so without this it tints the white sheet and the mark
          // vanishes into it — the same way iOS did before the icon was
          // inverted for it.
          {
            src: 'icons/icon-512-monochrome.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sumptus-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
    spaFallback(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'charts'
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
  }
})
