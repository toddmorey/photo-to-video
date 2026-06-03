import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '../output')
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm'])

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'video-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://localhost')

          // GET /api/videos — sorted list of video filenames
          if (url.pathname === '/api/videos' && req.method === 'GET') {
            try {
              const files = readdirSync(OUTPUT_DIR)
                .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
                .sort()
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(files))
            } catch {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify([]))
            }
            return
          }

          // GET /api/video/:filename — stream a video file
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
