#!/usr/bin/env node
// Upload (or replace) finished clips on Cloudflare Stream so the production
// viewer picks them up. The viewer matches videos by meta.name (e.g.
// "starwars.mp4"), so for each clip we: upload output/<clip>.mp4, set its
// meta.name, wait until it's ready to stream, then delete the previous video
// that had the same name. Run from the project root:
//
//   node upload-to-cloudflare.mjs starwars goofys-kitchen ...
//   node upload-to-cloudflare.mjs --all        # every mp4 in output/
//
// Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_KEY (with Stream
// edit permission) in .env.
import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID
// Uploading/deleting needs a token with Stream:Edit. Prefer a dedicated edit
// token so the production listing token (CLOUDFLARE_STREAM_API_KEY) can stay
// read-only; fall back to it if no edit token is set.
const TOKEN = process.env.CLOUDFLARE_EDIT_API_KEY || process.env.CLOUDFLARE_STREAM_EDIT_TOKEN || process.env.CLOUDFLARE_STREAM_API_KEY
if (!ACCOUNT || !TOKEN) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID or a Stream token in .env')
  process.exit(1)
}
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream`
const auth = { Authorization: `Bearer ${TOKEN}` }
const OUTPUT_DIR = path.resolve('output')

async function listVideos() {
  const r = await fetch(BASE, { headers: auth })
  const j = await r.json()
  if (!j.success) throw new Error('list failed: ' + JSON.stringify(j.errors))
  return j.result || []
}

async function uploadOne(name) {
  const file = path.join(OUTPUT_DIR, `${name}.mp4`)
  const buf = await fs.readFile(file)
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'video/mp4' }), `${name}.mp4`)
  const r = await fetch(BASE, { method: 'POST', headers: auth, body: form })
  const j = await r.json()
  if (!j.success) throw new Error(`upload failed (${name}): ` + JSON.stringify(j.errors))
  const uid = j.result.uid
  // Name it so the viewer (which keys off meta.name) lists it correctly.
  await fetch(`${BASE}/${uid}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta: { name: `${name}.mp4` } }),
  })
  return uid
}

async function waitReady(uid, { tries = 120, intervalMs = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${BASE}/${uid}`, { headers: auth })
    const j = await r.json()
    if (j.result?.readyToStream) return
    await new Promise((s) => setTimeout(s, intervalMs))
  }
  throw new Error(`timed out waiting for ${uid} to become ready`)
}

async function deleteVideo(uid) {
  await fetch(`${BASE}/${uid}`, { method: 'DELETE', headers: auth })
}

// Enable the progressive MP4 download for a video. The viewer plays this MP4
// (full resolution from the first frame) instead of HLS, which starts blurry
// and ramps up. Downloads are off by default; POSTing here generates the MP4
// (async on Cloudflare's side, but the URL becomes valid within a minute).
async function enableDownload(uid) {
  const r = await fetch(`${BASE}/${uid}/downloads`, { method: 'POST', headers: auth })
  const j = await r.json()
  if (!j.success) throw new Error(`enable download failed (${uid}): ` + JSON.stringify(j.errors))
}

async function main() {
  let names = process.argv.slice(2)
  if (names[0] === '--all') {
    const files = await fs.readdir(OUTPUT_DIR)
    names = files.filter((f) => f.endsWith('.mp4')).map((f) => f.replace(/\.mp4$/, ''))
  }
  names = names.map((n) => n.replace(/\.mp4$/, '')).filter(Boolean)
  if (!names.length) {
    console.error('Usage: node upload-to-cloudflare.mjs <clip> [clip...]  |  --all')
    process.exit(1)
  }

  const before = await listVideos()
  console.log(`Replacing ${names.length} clip(s) on Cloudflare Stream:\n`)

  for (const name of names) {
    const old = before.find((v) => (v.meta?.name) === `${name}.mp4`)
    process.stdout.write(`  ${name}.mp4 — uploading… `)
    const newUid = await uploadOne(name)
    process.stdout.write(`processing… `)
    await waitReady(newUid)
    await enableDownload(newUid)
    if (old && old.uid !== newUid) {
      await deleteVideo(old.uid)
      console.log(`live (${newUid}), removed old ${old.uid}`)
    } else {
      console.log(`live (${newUid}, new — no prior version)`)
    }
  }

  console.log('\nDone. The production viewer will list the updated clips.')
}

main().catch((e) => { console.error('\nERROR:', e.message); process.exit(1) })
