import { useState, useEffect, useRef, useCallback } from 'react'
import { Stream } from '@cloudflare/stream-react'
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconLayoutGrid,
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
  IconX,
  IconVideoOff,
} from '@tabler/icons-react'

const SWIPE_THRESHOLD = 40

function slugOf(name) {
  return name.replace(/\.[^.]+$/, '')
}

// Cross-browser fullscreen helpers. iPadOS Safari (16.4+) supports the standard
// Fullscreen API on a regular element, which hides the browser chrome; older
// WebKit needs the webkit-prefixed variants.
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement)
}
function requestFullscreen() {
  const el = document.documentElement
  ;(el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)
}
function exitFullscreen() {
  ;(document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
}

export default function App() {
  const [videos, setVideos] = useState([])   // [{ name, uid, duration, thumbnail }]
  const [index, setIndex] = useState(0)
  const [view, setView] = useState('player')  // 'player' | 'gallery'
  const [loading, setLoading] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
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

  // Reset the loading indicator whenever we switch to a different clip.
  useEffect(() => { setLoading(true) }, [index])

  // Track fullscreen state so the toggle icon stays in sync (e.g. when the
  // user leaves fullscreen with the Esc key or a system gesture).
  useEffect(() => {
    const sync = () => setFullscreen(isFullscreen())
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])

  const goNext = useCallback(() => setIndex(i => (i + 1) % videos.length), [videos.length])
  const goPrev = useCallback(() => setIndex(i => (i - 1 + videos.length) % videos.length), [videos.length])

  const toggleFullscreen = useCallback(() => {
    isFullscreen() ? exitFullscreen() : requestFullscreen()
  }, [])

  // Keyboard nav for desktop
  useEffect(() => {
    const handler = e => {
      if (view === 'gallery') {
        if (e.key === 'Escape') setView('player')
        return
      }
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft')  goPrev()
      if (e.key === 'f') toggleFullscreen()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goNext, goPrev, toggleFullscreen, view])

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

  function openFromGallery(i) {
    setIndex(i)
    setView('player')
  }

  if (!videos.length) return null

  if (view === 'gallery') {
    return (
      <Gallery
        videos={videos}
        current={index}
        onPick={openFromGallery}
        onClose={() => setView('player')}
      />
    )
  }

  const current = videos[index]

  // Media events that bracket buffering, shared by the Stream component and the
  // local <video> fallback, so the spinner appears whenever playback stalls.
  const onBuffering = () => setLoading(true)
  const onReady = () => setLoading(false)

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
        @keyframes viewer-spin { to { transform: rotate(360deg); } }
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
          onLoadStart={onBuffering}
          onWaiting={onBuffering}
          onStalled={onBuffering}
          onPlaying={onReady}
          onCanPlay={onReady}
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
          onLoadStart={onBuffering}
          onWaiting={onBuffering}
          onStalled={onBuffering}
          onPlaying={onReady}
          onCanPlay={onReady}
        />
      )}

      {/* Transparent layer above the player iframe so swipe gestures register
          (a cross-origin iframe would otherwise swallow touch events). */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      />

      {/* Loading spinner — shown while the current clip is still buffering. */}
      {loading && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', color: '#fff',
          }}
        >
          <IconRefresh size={56} stroke={1.75}
            style={{ opacity: 0.85, animation: 'viewer-spin 1s linear infinite' }} />
        </div>
      )}

      {/* Top-left: fullscreen toggle. Top-right: gallery. */}
      <IconControl
        side="left"
        label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onClick={toggleFullscreen}
      >
        {fullscreen ? <IconArrowsMinimize size={26} /> : <IconArrowsMaximize size={26} />}
      </IconControl>
      <IconControl side="right" label="Gallery" onClick={() => setView('gallery')}>
        <IconLayoutGrid size={26} />
      </IconControl>

      <ArrowButton onClick={goPrev} label="Previous" side="left">
        <IconChevronLeft size={40} />
      </ArrowButton>
      <ArrowButton onClick={goNext} label="Next" side="right">
        <IconChevronRight size={40} />
      </ArrowButton>
    </div>
  )
}

// Small circular control button pinned to a top corner.
function IconControl({ side, label, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        position: 'absolute', top: 'max(16px, env(safe-area-inset-top))',
        [side]: 'max(16px, env(safe-area-inset-' + side + '))',
        zIndex: 4,
        width: 48, height: 48, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)', border: 'none', cursor: 'pointer',
        color: '#fff', opacity: 0.6,
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = 1)}
      onMouseLeave={e => (e.currentTarget.style.opacity = 0.6)}
    >
      {children}
    </button>
  )
}

// Full-height edge button for prev/next navigation.
function ArrowButton({ onClick, label, side, children }) {
  return (
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
        opacity: 0.35, color: '#fff', zIndex: 2,
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = 0.85)}
      onMouseLeave={e => (e.currentTarget.style.opacity = 0.35)}
    >
      {children}
    </button>
  )
}

// Thumbnail grid. Tapping a tile opens that clip in the player.
function Gallery({ videos, current, onPick, onClose }) {
  // Track thumbnails that fail to load (e.g. a Cloudflare thumbnail that isn't
  // generated yet) so we can show the placeholder instead of a broken tile.
  const [failed, setFailed] = useState({})
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: '#0a0a0a', color: '#fff',
        display: 'grid',
        // Fixed 4×3 grid that fills the viewport (12 clips). Extra clips flow
        // into equally-sized implicit rows.
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gridAutoRows: '1fr',
        gap: 16,
        padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close gallery"
        style={{
          position: 'absolute', zIndex: 2,
          top: 'max(16px, env(safe-area-inset-top))',
          right: 'max(16px, env(safe-area-inset-right))',
          width: 48, height: 48, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer',
          color: '#fff',
        }}
      >
        <IconX size={26} />
      </button>

      {videos.map((v, i) => (
        <button
          key={v.uid || v.name}
          onClick={() => onPick(i)}
          aria-label={slugOf(v.name)}
          style={{
            position: 'relative', display: 'block', padding: 0, minHeight: 0,
            border: i === current ? '2px solid #fff' : '2px solid transparent',
            borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
            background: '#1a1a1a',
          }}
        >
          {v.thumbnail && !failed[i] ? (
            <img
              src={v.thumbnail}
              alt={slugOf(v.name)}
              loading="lazy"
              onError={() => setFailed(f => ({ ...f, [i]: true }))}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#555',
            }}>
              <IconVideoOff size={32} />
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
