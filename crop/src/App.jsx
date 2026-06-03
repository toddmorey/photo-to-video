import { useState, useEffect, useRef } from 'react'

const ASPECT = 16 / 9
const HANDLE_R = 8

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ─── Canvas helpers ──────────────────────────────────────────────────────────

function getDisplay(canvas, img) {
  if (!canvas || !img) return null
  const scale = Math.min(canvas.width / img.width, canvas.height / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  const ox = (canvas.width - dw) / 2
  const oy = (canvas.height - dh) / 2
  return { scale, ox, oy, dw, dh }
}

function cropToDisplay(crop, d) {
  return {
    x: crop.x * d.scale + d.ox,
    y: crop.y * d.scale + d.oy,
    w: crop.w * d.scale,
    h: crop.h * d.scale,
  }
}

function clientToCanvas(e, canvas) {
  const r = canvas.getBoundingClientRect()
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top)  * (canvas.height / r.height),
  }
}

function canvasToImage(cx, cy, d) {
  return { x: (cx - d.ox) / d.scale, y: (cy - d.oy) / d.scale }
}

function defaultCrop(img) {
  const imgAspect = img.width / img.height
  let w, h
  if (imgAspect > ASPECT) { h = img.height; w = h * ASPECT }
  else                     { w = img.width;  h = w / ASPECT }
  return { x: (img.width - w) / 2, y: (img.height - h) / 2, w, h }
}

function clampCrop(crop, img) {
  const w = clamp(crop.w, 1, img.width)
  const h = w / ASPECT
  const x = clamp(crop.x, 0, img.width  - w)
  const y = clamp(crop.y, 0, img.height - h)
  return { x, y, w, h }
}

function hitTest(cx, cy, crop, d) {
  if (!crop) return 'new'
  const dc = cropToDisplay(crop, d)
  const corners = [
    { name: 'tl', x: dc.x,        y: dc.y },
    { name: 'tr', x: dc.x + dc.w, y: dc.y },
    { name: 'bl', x: dc.x,        y: dc.y + dc.h },
    { name: 'br', x: dc.x + dc.w, y: dc.y + dc.h },
  ]
  for (const c of corners) {
    if (Math.hypot(cx - c.x, cy - c.y) < HANDLE_R + 4) return c.name
  }
  if (cx > dc.x && cx < dc.x + dc.w && cy > dc.y && cy < dc.y + dc.h) return 'move'
  return 'new'
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function drawScene(canvas, img, crop) {
  if (!canvas || !img) return
  const ctx = canvas.getContext('2d')
  const d = getDisplay(canvas, img)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, d.ox, d.oy, d.dw, d.dh)
  if (!crop) return

  const { x: cx, y: cy, w: cw, h: ch } = cropToDisplay(crop, d)

  // Dark overlay outside crop
  ctx.fillStyle = 'rgba(0,0,0,0.65)'
  ctx.fillRect(d.ox, d.oy,        d.dw, cy - d.oy)
  ctx.fillRect(d.ox, cy + ch,     d.dw, d.oy + d.dh - cy - ch)
  ctx.fillRect(d.ox, cy,          cx - d.ox, ch)
  ctx.fillRect(cx + cw, cy,       d.ox + d.dw - cx - cw, ch)

  // Crop border
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.strokeRect(cx, cy, cw, ch)

  // Rule-of-thirds grid
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const f of [1/3, 2/3]) {
    ctx.moveTo(cx + cw * f, cy);       ctx.lineTo(cx + cw * f, cy + ch)
    ctx.moveTo(cx,          cy + ch * f); ctx.lineTo(cx + cw, cy + ch * f)
  }
  ctx.stroke()

  // Corner handles
  for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function App() {
  const [images,  setImages]  = useState([])
  const [current, setCurrent] = useState(null)
  const [filter,  setFilter]  = useState('')
  const [status,  setStatus]  = useState('Select an image to begin.')
  const [info,    setInfo]    = useState(null)
  const [saved,   setSaved]   = useState([])   // base names (no extension) of saved images

  const canvasRef = useRef(null)
  const imgRef    = useRef(null)
  const cropRef   = useRef(null)
  const dispRef   = useRef(null)
  const dragRef   = useRef(null)

  // Load image list
  useEffect(() => {
    fetch('/api/list')
      .then(r => r.json())
      .then(list => setImages(list))
      .catch(() => setStatus('⚠ Could not load image list. Is the dev server running?'))
  }, [])

  // Size canvas to its container
  useEffect(() => {
    const canvas = canvasRef.current
    const ro = new ResizeObserver(() => {
      const container = canvas.parentElement
      canvas.width  = container.clientWidth
      canvas.height = container.clientHeight
      redraw()
    })
    ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  }, [])

  function redraw() {
    const canvas = canvasRef.current
    const img    = imgRef.current
    const crop   = cropRef.current
    const d = getDisplay(canvas, img)
    dispRef.current = d
    drawScene(canvas, img, crop)
  }

  // Load image when selection changes
  useEffect(() => {
    if (!current) return
    setStatus('Loading…')
    setInfo(null)
    const img = new Image()
    img.onload = () => {
      imgRef.current  = img
      cropRef.current = defaultCrop(img)
      redraw()
      syncInfo()
      setStatus(`${img.width} × ${img.height} px`)
    }
    img.onerror = () => setStatus('⚠ Failed to load image.')
    img.src = '/api/image?path=' + encodeURIComponent(current)
  }, [current])

  function syncInfo() {
    const c = cropRef.current
    if (c) setInfo({ x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) })
  }

  function handleReset() {
    if (!imgRef.current) return
    cropRef.current = defaultCrop(imgRef.current)
    redraw()
    syncInfo()
  }

  // ── Mouse interactions ─────────────────────────────────────────────────────

  function onMouseDown(e) {
    const canvas = canvasRef.current
    const d = dispRef.current
    if (!imgRef.current || !d) return
    e.preventDefault()

    const { x: cx, y: cy } = clientToCanvas(e, canvas)
    const handle = hitTest(cx, cy, cropRef.current, d)
    const imgPos = canvasToImage(cx, cy, d)

    dragRef.current = {
      type: handle,
      startCx: cx, startCy: cy,
      startIx: imgPos.x, startIy: imgPos.y,
      startCrop: cropRef.current ? { ...cropRef.current } : null,
    }
  }

  function onMouseMove(e) {
    const drag   = dragRef.current
    const canvas = canvasRef.current
    const img    = imgRef.current
    const d      = dispRef.current
    if (!drag || !img || !d) return

    const { x: cx, y: cy } = clientToCanvas(e, canvas)
    const ip = canvasToImage(cx, cy, d)
    const dx = ip.x - drag.startIx
    const dy = ip.y - drag.startIy
    const sc = drag.startCrop

    let crop = { ...cropRef.current }

    switch (drag.type) {
      case 'new': {
        const rawW = Math.abs(ip.x - drag.startIx)
        const w    = Math.max(20, rawW)
        const h    = w / ASPECT
        crop = {
          x: dx >= 0 ? drag.startIx : drag.startIx - w,
          y: drag.startIy - h / 2,
          w, h,
        }
        break
      }
      case 'move':
        if (sc) crop = { ...sc, x: sc.x + dx, y: sc.y + dy }
        break
      case 'br':
        if (sc) { const w = Math.max(20, sc.w + dx); crop = { x: sc.x, y: sc.y, w, h: w / ASPECT } }
        break
      case 'bl':
        if (sc) { const w = Math.max(20, sc.w - dx); crop = { x: sc.x + sc.w - w, y: sc.y, w, h: w / ASPECT } }
        break
      case 'tr':
        if (sc) { const w = Math.max(20, sc.w + dx); const h = w / ASPECT; crop = { x: sc.x, y: sc.y + sc.h - h, w, h } }
        break
      case 'tl':
        if (sc) { const w = Math.max(20, sc.w - dx); const h = w / ASPECT; crop = { x: sc.x + sc.w - w, y: sc.y + sc.h - h, w, h } }
        break
    }

    cropRef.current = clampCrop(crop, img)
    syncInfo()
    redraw()
  }

  function onMouseUp() { dragRef.current = null }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function saveCrop() {
    const img  = imgRef.current
    const crop = cropRef.current
    if (!img || !crop || !current) return

    const off = document.createElement('canvas')
    off.width  = Math.round(crop.w)
    off.height = Math.round(crop.h)
    off.getContext('2d').drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, off.width, off.height)

    const dataUrl  = off.toDataURL('image/jpeg', 0.92)
    const basename = current.split('/').pop().replace(/\.[^.]+$/, '')

    setStatus('Saving…')
    try {
      const res  = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalPath: current, dataUrl }),
      })
      const data = await res.json()
      if (data.success) {
        setSaved(prev => [basename, ...prev.filter(n => n !== basename)])
        // Refresh the image list in case the extension changed (e.g. .png → .jpg)
        fetch('/api/list').then(r => r.json()).then(list => {
          setImages(list)
          // Update current to the new .jpg path if it changed
          const newPath = list.find(p => p.replace(/\.[^.]+$/, '').split('/').pop() === basename)
          if (newPath && newPath !== current) setCurrent(newPath)
        })
        setStatus(`✓ Saved → images/${data.path}`)
      } else {
        setStatus('⚠ Save error: ' + data.error)
      }
    } catch (e) {
      setStatus('⚠ ' + e.message)
    }
  }

  // ── Filtered / grouped image list ──────────────────────────────────────────

  const filtered = filter.trim()
    ? images.filter(p => p.toLowerCase().includes(filter.toLowerCase()))
    : images

  const grouped = {}
  for (const p of filtered) {
    const folder = p.includes('/') ? p.split('/')[0] : '.'
    ;(grouped[folder] ??= []).push(p)
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const s = {
    root:    { display: 'flex', height: '100vh', fontFamily: '"SF Mono", "Inconsolata", monospace', background: '#0a0a0a', color: '#d0d0d0', fontSize: 12 },
    sidebar: { width: 260, borderRight: '1px solid #1e1e1e', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' },
    sideTop: { padding: '14px 12px 10px', borderBottom: '1px solid #1e1e1e', position: 'sticky', top: 0, background: '#0a0a0a', zIndex: 1 },
    title:   { fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#555', marginBottom: 10 },
    input:   { width: '100%', background: '#141414', border: '1px solid #2a2a2a', color: '#d0d0d0', padding: '5px 8px', borderRadius: 4, fontSize: 11, outline: 'none' },
    count:   { fontSize: 10, color: '#444', marginTop: 6 },
    folder:  { padding: '8px 12px 3px', fontSize: 10, letterSpacing: '0.06em', color: '#444', textTransform: 'uppercase' },
    item:    (active, wasSaved) => ({
      padding: '5px 12px 5px 16px',
      cursor: 'pointer',
      background: active ? '#162033' : 'transparent',
      color: active ? '#70b0ff' : wasSaved ? '#5dba6e' : '#999',
      borderLeft: active ? '2px solid #3b89ff' : '2px solid transparent',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }),
    main:    { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
    toolbar: { padding: '8px 14px', borderBottom: '1px solid #1e1e1e', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 },
    btn:     (enabled, primary) => ({
      background: enabled ? (primary ? '#1a4a2a' : '#1e1e1e') : '#111',
      border: `1px solid ${enabled ? (primary ? '#3d8a52' : '#333') : '#1a1a1a'}`,
      color: enabled ? (primary ? '#6ee09a' : '#bbb') : '#3a3a3a',
      padding: '4px 14px', borderRadius: 4, cursor: enabled ? 'pointer' : 'default',
      fontSize: 11, fontFamily: 'inherit', fontWeight: primary ? 600 : 400,
    }),
    info:    { fontSize: 11, color: '#555', fontVariantNumeric: 'tabular-nums' },
    canvas:  { flex: 1, position: 'relative', background: '#111', overflow: 'hidden' },
    status:  { padding: '5px 14px', borderTop: '1px solid #141414', fontSize: 10, color: '#444', flexShrink: 0 },
  }

  const hasImg  = !!imgRef.current
  const hasCrop = !!cropRef.current

  return (
    <div style={s.root}>
      {/* ── Sidebar ── */}
      <aside style={s.sidebar}>
        <div style={s.sideTop}>
          <div style={s.title}>PHOTO TO VIDEO · CROP 16:9</div>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter…"
            style={s.input}
            spellCheck={false}
          />
          <div style={s.count}>{filtered.length} of {images.length} images</div>
        </div>

        {Object.entries(grouped).map(([folder, paths]) => (
          <div key={folder}>
            <div style={s.folder}>{folder === '.' ? 'images' : folder}</div>
            {paths.map(p => {
              const name = p.split('/').pop()
              const base = name.replace(/\.[^.]+$/, '')
              const isSaved = saved.includes(base)
              return (
                <div
                  key={p}
                  onClick={() => setCurrent(p)}
                  style={s.item(current === p, isSaved)}
                  title={p}
                >
                  {isSaved ? '✓ ' : ''}{name}
                </div>
              )
            })}
          </div>
        ))}
      </aside>

      {/* ── Main ── */}
      <main style={s.main}>
        {/* Toolbar */}
        <div style={s.toolbar}>
          <button onClick={handleReset} disabled={!hasImg} style={s.btn(hasImg, false)}>
            Reset crop
          </button>

          {info && (
            <span style={s.info}>
              {info.x}, {info.y}  →  {info.w} × {info.h} px
            </span>
          )}

          <div style={{ flex: 1 }} />

          {saved.length > 0 && (
            <span style={{ fontSize: 10, color: '#4a8a5a' }}>{saved.length} saved</span>
          )}

          <button onClick={saveCrop} disabled={!hasImg || !hasCrop} style={s.btn(hasImg && hasCrop, true)}>
            Save crop  ↓
          </button>
        </div>

        {/* Canvas area */}
        <div style={s.canvas}>
          <canvas
            ref={canvasRef}
            style={{ display: 'block', cursor: 'crosshair' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
          {!current && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#2a2a2a', fontSize: 14, pointerEvents: 'none',
            }}>
              ← select an image
            </div>
          )}
        </div>

        {/* Status bar */}
        <div style={s.status}>{status}</div>
      </main>
    </div>
  )
}
