import { useState, useEffect, useRef, useCallback } from 'react'

const SWIPE_THRESHOLD = 40

function slugOf(filename) {
  return filename.replace(/\.[^.]+$/, '')
}

export default function App() {
  const [videos, setVideos] = useState([])
  const [index, setIndex] = useState(0)
  const touchStartX = useRef(null)

  // Load video list, restore index from URL hash
  useEffect(() => {
    fetch('/api/videos')
      .then(r => r.json())
      .then(list => {
        setVideos(list)
        const slug = location.hash.slice(1)
        if (slug) {
          const i = list.findIndex(v => slugOf(v) === slug)
          if (i >= 0) setIndex(i)
        }
      })
  }, [])

  // Keep URL hash in sync with current video
  useEffect(() => {
    if (!videos.length) return
    history.replaceState(null, '', '#' + slugOf(videos[index]))
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

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#000' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <video
        key={index}
        src={`/api/video/${encodeURIComponent(videos[index])}`}
        autoPlay
        loop
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}
