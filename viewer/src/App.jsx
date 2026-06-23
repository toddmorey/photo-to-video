import { useState, useEffect, useRef, useCallback } from 'react'
import { Stream } from '@cloudflare/stream-react'

const SWIPE_THRESHOLD = 40

function slugOf(name) {
  return name.replace(/\.[^.]+$/, '')
}

export default function App() {
  const [videos, setVideos] = useState([])   // [{ name, uid, duration }]
  const [index, setIndex] = useState(0)
  const touchStartX = useRef(null)

  // Load video list, restore index from URL hash
  useEffect(() => {
    fetch('/api/videos')
      .then(r => r.json())
      .then(({ videos: list }) => {
        setVideos(list)
        const slug = location.hash.slice(1)
        if (slug) {
          const i = list.findIndex(v => slugOf(v.name) === slug)
          if (i >= 0) setIndex(i)
        }
      })
      .catch(() => setVideos([]))
  }, [])

  // Keep URL hash in sync with current video
  useEffect(() => {
    if (!videos.length) return
    history.replaceState(null, '', '#' + slugOf(videos[index].name))
  }, [index, videos])

  const goNext = useCallback(() => setIndex(i => (i + 1) % videos.length), [videos.length])
  const goPrev = useCallback(() => setIndex(i => (i - 1 + videos.length) % videos.length), [videos.length])

  // Keyboard nav for desktop
  useEffect(() => {
    const handler = e => {
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft')  goPrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goNext, goPrev])

  function onTouchStart(e) {
    touchStartX.current = e.touches[0].clientX
  }

  function onTouchEnd(e) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < SWIPE_THRESHOLD) return
    dx > 0 ? goNext() : goPrev()
  }

  if (!videos.length) return null

  const current = videos[index]

  const arrowBtn = (onClick, label, side) => (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        position: 'absolute', top: 0, [side]: 0,
        width: 80, height: '100%',
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center',
        justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
        padding: '0 18px',
        opacity: 0.35,
        color: '#fff',
        fontSize: 36,
        zIndex: 2,
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = 0.85}
      onMouseLeave={e => e.currentTarget.style.opacity = 0.35}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  )

  return (
    <div className="viewer-root" style={{ position: 'fixed', inset: 0, background: '#000' }}>
      {/* Force the Cloudflare Stream iframe (and the fallback <video>) to fill the
          viewport. The component's own height prop doesn't resolve through its
          wrapper, so we pin the iframe with position:absolute instead. */}
      <style>{`
        .viewer-root iframe,
        .viewer-root video {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          border: 0; object-fit: contain;
        }
      `}</style>

      {current.uid ? (
        <Stream
          key={current.uid}
          src={current.uid}
          autoplay
          loop
          muted
          controls={false}
          preload="auto"
          responsive={false}
        />
      ) : (
        <video
          key={current.name}
          src={`/api/video/${encodeURIComponent(current.name)}`}
          autoPlay
          loop
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}

      {/* Transparent layer above the player iframe so swipe gestures register
          (a cross-origin iframe would otherwise swallow touch events). */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      />

      {arrowBtn(goPrev, 'Previous', 'left')}
      {arrowBtn(goNext, 'Next', 'right')}
    </div>
  )
}
