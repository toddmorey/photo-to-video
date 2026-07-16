// Shared Cloudflare Stream listing logic, used by both the Vite dev middleware
// (local dev) and the Netlify Function (production). Pure — credentials are
// passed in, never read from the environment here.

export async function listCloudflareVideos({ accountId, token }) {
  if (!accountId || !token) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_STREAM_API_KEY not set')
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Cloudflare Stream API ${res.status}`)
  const body = await res.json()
  if (!body.success) throw new Error('Cloudflare Stream API returned success=false')

  return (body.result || [])
    .filter(v => v.readyToStream)
    .map(v => {
      const hls = v.playback?.hls || null
      return {
        name: v.meta?.name || v.meta?.filename || v.uid,
        uid: v.uid,
        duration: v.duration,
        // Cloudflare auto-generates a thumbnail; the URL embeds the customer
        // subdomain, so it's self-contained for the gallery grid.
        thumbnail: v.thumbnail || null,
        // Direct HLS manifest URL — kept as a fallback for the viewer.
        hls,
        // Preferred playback URL: a single-resolution progressive MP4. Unlike
        // HLS, it has no adaptive-bitrate ramp-up, so the clip plays at full
        // resolution from the first frame instead of starting blurry and
        // sharpening a few seconds in. Derived from the HLS base — the MP4 is
        // served once downloads are enabled for the video (see
        // upload-to-cloudflare.mjs). The viewer falls back to `hls` if it 404s.
        mp4: mp4FromHls(hls),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Turn an HLS manifest URL into the matching MP4 download URL. They share the
// same customer subdomain and video UID; only the trailing path differs:
//   .../<uid>/manifest/video.m3u8  ->  .../<uid>/downloads/default.mp4
function mp4FromHls(hls) {
  if (!hls) return null
  return hls.replace(/\/manifest\/video\.m3u8.*$/, '/downloads/default.mp4')
}
