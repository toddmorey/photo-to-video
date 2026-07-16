#!/usr/bin/env node
// Enable the progressive MP4 download for every video on Cloudflare Stream.
// The viewer prefers the MP4 (full resolution from the first frame) over HLS
// (which starts blurry and ramps up via adaptive bitrate). Downloads are off
// by default, so run this once for the existing catalog; new uploads get it
// automatically via upload-to-cloudflare.mjs.
//
//   node enable-downloads.mjs           # enable for all videos
//   node enable-downloads.mjs --status  # just report each video's MP4 status
//
// Requires CLOUDFLARE_ACCOUNT_ID and a Stream token with edit permission.
import 'dotenv/config'

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID
const TOKEN = process.env.CLOUDFLARE_EDIT_API_KEY || process.env.CLOUDFLARE_STREAM_EDIT_TOKEN || process.env.CLOUDFLARE_STREAM_API_KEY
if (!ACCOUNT || !TOKEN) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID or a Stream token in .env')
  process.exit(1)
}
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream`
const auth = { Authorization: `Bearer ${TOKEN}` }
const statusOnly = process.argv.includes('--status')

async function listVideos() {
  const r = await fetch(BASE, { headers: auth })
  const j = await r.json()
  if (!j.success) throw new Error('list failed: ' + JSON.stringify(j.errors))
  return (j.result || []).filter((v) => v.readyToStream)
}

async function downloads(uid, method) {
  const r = await fetch(`${BASE}/${uid}/downloads`, { method, headers: auth })
  const j = await r.json()
  if (!j.success) throw new Error(JSON.stringify(j.errors))
  return j.result?.default || null
}

async function main() {
  const videos = await listVideos()
  console.log(`${videos.length} ready video(s):\n`)
  for (const v of videos) {
    const name = v.meta?.name || v.meta?.filename || v.uid
    process.stdout.write(`  ${name} — `)
    try {
      const d = statusOnly ? await downloads(v.uid, 'GET') : await downloads(v.uid, 'POST')
      console.log(d ? `${d.status}${d.percentComplete != null ? ` (${d.percentComplete}%)` : ''}` : 'no download')
    } catch (e) {
      console.log('error: ' + e.message)
    }
  }
  console.log('\nMP4 generation is async; re-run with --status to watch it finish.')
}

main().catch((e) => { console.error('\nERROR:', e.message); process.exit(1) })
