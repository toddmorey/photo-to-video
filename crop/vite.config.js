import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import path, { extname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const IMAGES_DIR = path.resolve(__dirname, '../images')

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
}

function listImages(dir, rel = '') {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      results.push(...listImages(join(dir, entry.name), relPath))
    } else if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) {
      results.push(relPath)
    }
  }
  return results
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'crop-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, 'http://localhost')

          // GET /api/list — return sorted image path list
          if (url.pathname === '/api/list' && req.method === 'GET') {
            try {
              const images = listImages(IMAGES_DIR).sort()
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(images))
            } catch (e) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: e.message }))
            }
            return
          }

          // GET /api/image?path=... — stream an image file
          if (url.pathname === '/api/image' && req.method === 'GET') {
            const rel = url.searchParams.get('path')
            if (!rel) { res.statusCode = 400; res.end('Missing path'); return }
            const full = path.resolve(IMAGES_DIR, rel)
            if (!full.startsWith(IMAGES_DIR)) { res.statusCode = 403; res.end('Forbidden'); return }
            const ext = extname(full).toLowerCase()
            res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
            createReadStream(full).pipe(res)
            return
          }

          // POST /api/save — write cropped JPEG back into images/, replacing the original.
          // Always saves as <basename>.jpg. If the original had a different extension,
          // the original file is deleted so the generate pipeline doesn't double-process.
          if (url.pathname === '/api/save' && req.method === 'POST') {
            try {
              const body = JSON.parse(await readBody(req))
              const { originalPath, dataUrl } = body
              if (!originalPath || !dataUrl) throw new Error('Missing originalPath or dataUrl')

              const origFull = path.resolve(IMAGES_DIR, originalPath)
              if (!origFull.startsWith(IMAGES_DIR)) { res.statusCode = 403; res.end('Forbidden'); return }

              const base64 = dataUrl.split(',')[1]
              const buf = Buffer.from(base64, 'base64')

              // Derive output filename — always .jpg
              const basename = path.basename(origFull, extname(origFull))
              const outPath = join(IMAGES_DIR, path.dirname(originalPath), `${basename}.jpg`)

              mkdirSync(path.dirname(outPath), { recursive: true })
              writeFileSync(outPath, buf)

              // Remove the original if it had a different extension (e.g. .png → .jpg)
              if (origFull !== outPath) {
                try { unlinkSync(origFull) } catch (_) {}
              }

              const relOut = path.relative(IMAGES_DIR, outPath)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true, path: relOut }))
            } catch (e) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: e.message }))
            }
            return
          }

          next()
        })
      },
    },
  ],
})
