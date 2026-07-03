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
    .map(v => ({
      name: v.meta?.name || v.meta?.filename || v.uid,
      uid: v.uid,
      duration: v.duration,
      // Cloudflare auto-generates a thumbnail; the URL embeds the customer
      // subdomain, so it's self-contained for the gallery grid.
      thumbnail: v.thumbnail || null,
      // Direct HLS manifest URL — played through a plain <video> tag instead
      // of Cloudflare's iframe player, since Safari has native HLS support
      // and this app only targets Apple devices for now.
      hls: v.playback?.hls || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
