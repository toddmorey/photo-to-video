import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
import { createReadStream, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { listCloudflareVideos } from './shared/cloudflareStream.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Load the project-root .env so the Cloudflare credentials are available here.
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const OUTPUT_DIR = path.resolve(__dirname, '../output')
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm'])

// Fallback: list local output files as [{ name, uid: null }] so the viewer
// still works without network / before videos are uploaded.
function listLocalVideos() {
  try {
    return readdirSync(OUTPUT_DIR)
      .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
      .sort()
      .map(name => ({ name, uid: null }))
  } catch {
    return []
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'video-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, 'http://localhost')

          // GET /api/videos — Cloudflare Stream videos, with local fallback.
          if (url.pathname === '/api/videos' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json')
            try {
              const videos = await listCloudflareVideos({
                accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
                token: process.env.CLOUDFLARE_STREAM_API_KEY,
              })
              res.end(JSON.stringify({ source: 'cloudflare', videos }))
            } catch (e) {
              server.config.logger.warn(`[video-api] Cloudflare list failed (${e.message}); serving local files`)
              res.end(JSON.stringify({ source: 'local', videos: listLocalVideos() }))
            }
            return
          }

          // GET /api/video/:filename — stream a local file (fallback playback only)
          if (url.pathname.startsWith('/api/video/') && req.method === 'GET') {
            const filename = decodeURIComponent(url.pathname.slice('/api/video/'.length))
            const full = path.resolve(OUTPUT_DIR, filename)
            if (!full.startsWith(OUTPUT_DIR)) { res.statusCode = 403; res.end('Forbidden'); return }
            const ext = path.extname(full).toLowerCase()
            const mime = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }
            res.setHeader('Content-Type', mime[ext] || 'video/mp4')
            createReadStream(full).on('error', () => { res.statusCode = 404; res.end() }).pipe(res)
            return
          }

          next()
        })
      },
    },
  ],
})
