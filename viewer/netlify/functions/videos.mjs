// Netlify Function (v2): serves GET /api/videos in production.
// Lists ready-to-stream Cloudflare Stream videos; the token stays server-side.
import { listCloudflareVideos } from '../../shared/cloudflareStream.mjs'

export default async () => {
  try {
    const videos = await listCloudflareVideos({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_STREAM_API_KEY,
    })
    return Response.json({ source: 'cloudflare', videos })
  } catch (e) {
    return Response.json(
      { source: 'cloudflare', videos: [], error: e.message },
      { status: 502 },
    )
  }
}

// In-code routing: this function answers /api/videos directly (no redirect rule).
export const config = { path: '/api/videos' }
