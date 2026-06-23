import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
import { createReadStream, readdirSync, existsSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import { listCloudflareVideos } from './shared/cloudflareStream.mjs'

const execFileAsync = promisify(execFile)
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Load the project-root .env so the Cloudflare credentials are available here.
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const OUTPUT_DIR = path.resolve(__dirname, '../output')
const THUMBS_DIR = path.resolve(OUTPUT_DIR, '.thumbs')
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm'])

// Fallback: list local output files as [{ name, uid: null }] so the viewer
// still works without network / before videos are uploaded. `thumbnail` points
// at the dev-only ffmpeg endpoint below.
function listLocalVideos() {
  try {
    return readdirSync(OUTPUT_DIR)
      .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
      .sort()
      .map(name => ({ name, uid: null, thumbnail: `/api/thumb/${encodeURIComponent(name)}` }))
  } catch {
    return []
  }
}

// Extract (and cache) a single representative frame from a local clip as a
// JPEG thumbnail. Grabs a frame ~0.5s in to avoid an occasional black frame 0.
async function ensureThumbnail(videoFile) {
  if (!existsSync(THUMBS_DIR)) mkdirSync(THUMBS_DIR, { recursive: true })
  const slug = path.basename(videoFile, path.extname(videoFile))
  const thumbPath = path.join(THUMBS_DIR, `${slug}.jpg`)
  if (!existsSync(thumbPath)) {
    await execFileAsync('ffmpeg', [
      '-ss', '0.5', '-i', videoFile,
      '-frames:v', '1', '-vf', "scale=480:-2",
      '-y', thumbPath,
    ])
  }
  return thumbPath
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

          // GET /api/thumb/:filename — ffmpeg-generated thumbnail for a local clip.
          if (url.pathname.startsWith('/api/thumb/') && req.method === 'GET') {
            const filename = decodeURIComponent(url.pathname.slice('/api/thumb/'.length))
            const full = path.resolve(OUTPUT_DIR, filename)
            if (!full.startsWith(OUTPUT_DIR)) { res.statusCode = 403; res.end('Forbidden'); return }
            try {
              const thumbPath = await ensureThumbnail(full)
              res.setHeader('Content-Type', 'image/jpeg')
              res.setHeader('Cache-Control', 'max-age=3600')
              createReadStream(thumbPath).on('error', () => { res.statusCode = 404; res.end() }).pipe(res)
            } catch (e) {
              server.config.logger.warn(`[video-api] thumbnail failed for ${filename}: ${e.message}`)
              res.statusCode = 500; res.end()
            }
            return
          }

          next()
        })
      },
    },
  ],
})
