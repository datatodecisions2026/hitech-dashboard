'use client'

import { useRef, useEffect } from 'react'

// Ported from React Bits <Waves /> (see waves.md). Dropped the stock CSS's
// ::before cursor dot (its var() calls were invalid) and the console.log.

class Grad {
  constructor(public x: number, public y: number, public z: number) {}
  dot2(x: number, y: number) { return this.x * x + this.y * y }
}

const P = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180]

class Noise {
  grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]].map(g => new Grad(g[0], g[1], g[2]))
  perm = new Array<number>(512)
  gradP = new Array<Grad>(512)
  constructor(seed = 0) {
    if (seed > 0 && seed < 1) seed *= 65536
    seed = Math.floor(seed)
    if (seed < 256) seed |= seed << 8
    for (let i = 0; i < 256; i++) {
      const v = i & 1 ? P[i] ^ (seed & 255) : P[i] ^ ((seed >> 8) & 255)
      this.perm[i] = this.perm[i + 256] = v
      this.gradP[i] = this.gradP[i + 256] = this.grad3[v % 12]
    }
  }
  fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
  lerp(a: number, b: number, t: number) { return (1 - t) * a + t * b }
  perlin2(x: number, y: number) {
    let X = Math.floor(x), Y = Math.floor(y)
    x -= X; y -= Y
    X &= 255; Y &= 255
    const n00 = this.gradP[X + this.perm[Y]].dot2(x, y)
    const n01 = this.gradP[X + this.perm[Y + 1]].dot2(x, y - 1)
    const n10 = this.gradP[X + 1 + this.perm[Y]].dot2(x - 1, y)
    const n11 = this.gradP[X + 1 + this.perm[Y + 1]].dot2(x - 1, y - 1)
    const u = this.fade(x)
    return this.lerp(this.lerp(n00, n10, u), this.lerp(n01, n11, u), this.fade(y))
  }
}

interface Pt { x: number; y: number; wave: { x: number; y: number }; cursor: { x: number; y: number; vx: number; vy: number } }

interface Props {
  lineColor?: string
  waveSpeedX?: number; waveSpeedY?: number
  waveAmpX?: number; waveAmpY?: number
  xGap?: number; yGap?: number
  friction?: number; tension?: number; maxCursorMove?: number
}

export default function Waves(props: Props) {
  const {
    lineColor = 'black', waveSpeedX = 0.0125, waveSpeedY = 0.005, waveAmpX = 32, waveAmpY = 16,
    xGap = 10, yGap = 32, friction = 0.925, tension = 0.005, maxCursorMove = 100,
  } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read live by the animation loop, so a theme change recolours without a remount.
  const cfg = useRef({ lineColor, waveSpeedX, waveSpeedY, waveAmpX, waveAmpY, friction, tension, maxCursorMove, xGap, yGap })
  cfg.current = { lineColor, waveSpeedX, waveSpeedY, waveAmpX, waveAmpY, friction, tension, maxCursorMove, xGap, yGap }

  useEffect(() => {
    const canvas = canvasRef.current!, container = containerRef.current!
    const ctx = canvas.getContext('2d')!
    const noise = new Noise(Math.random())
    let lines: Pt[][] = []
    let w = 0, h = 0, left = 0, top = 0, frame = 0
    const m = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, vs: 0, a: 0, set: false }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    function setSize() {
      const b = container.getBoundingClientRect()
      w = canvas.width = b.width; h = canvas.height = b.height; left = b.left; top = b.top
    }
    function setLines() {
      const { xGap, yGap } = cfg.current
      const nLines = Math.ceil((w + 200) / xGap), nPts = Math.ceil((h + 30) / yGap)
      const xs = (w - xGap * nLines) / 2, ys = (h - yGap * nPts) / 2
      lines = []
      for (let i = 0; i <= nLines; i++) {
        const pts: Pt[] = []
        for (let j = 0; j <= nPts; j++) pts.push({ x: xs + xGap * i, y: ys + yGap * j, wave: { x: 0, y: 0 }, cursor: { x: 0, y: 0, vx: 0, vy: 0 } })
        lines.push(pts)
      }
    }
    function move(t: number) {
      const { waveSpeedX, waveSpeedY, waveAmpX, waveAmpY, friction, tension, maxCursorMove } = cfg.current
      for (const pts of lines) for (const p of pts) {
        const mv = noise.perlin2((p.x + t * waveSpeedX) * 0.002, (p.y + t * waveSpeedY) * 0.0015) * 12
        p.wave.x = Math.cos(mv) * waveAmpX
        p.wave.y = Math.sin(mv) * waveAmpY
        const dist = Math.hypot(p.x - m.sx, p.y - m.sy), l = Math.max(175, m.vs)
        if (dist < l) {
          const f = Math.cos(dist * 0.001) * (1 - dist / l)
          p.cursor.vx += Math.cos(m.a) * f * l * m.vs * 0.00065
          p.cursor.vy += Math.sin(m.a) * f * l * m.vs * 0.00065
        }
        p.cursor.vx += -p.cursor.x * tension
        p.cursor.vy += -p.cursor.y * tension
        p.cursor.vx *= friction; p.cursor.vy *= friction
        p.cursor.x = Math.min(maxCursorMove, Math.max(-maxCursorMove, p.cursor.x + p.cursor.vx * 2))
        p.cursor.y = Math.min(maxCursorMove, Math.max(-maxCursorMove, p.cursor.y + p.cursor.vy * 2))
      }
    }
    const at = (p: Pt, c = true) => ({ x: p.x + p.wave.x + (c ? p.cursor.x : 0), y: p.y + p.wave.y + (c ? p.cursor.y : 0) })
    function draw() {
      ctx.clearRect(0, 0, w, h)
      ctx.beginPath()
      ctx.strokeStyle = cfg.current.lineColor
      for (const pts of lines) {
        const s = at(pts[0], false)
        ctx.moveTo(s.x, s.y)
        pts.forEach((p, i) => {
          const last = i === pts.length - 1
          const a = at(p, !last)
          ctx.lineTo(a.x, a.y)
          if (last) ctx.moveTo(a.x, a.y)
        })
      }
      ctx.stroke()
    }
    function tick(t: number) {
      m.sx += (m.x - m.sx) * 0.1; m.sy += (m.y - m.sy) * 0.1
      const dx = m.x - m.lx, dy = m.y - m.ly, d = Math.hypot(dx, dy)
      m.vs = Math.min(100, m.vs + (d - m.vs) * 0.1)
      m.lx = m.x; m.ly = m.y; m.a = Math.atan2(dy, dx)
      move(t); draw()
      if (!reduced) frame = requestAnimationFrame(tick)
    }
    function onResize() { setSize(); setLines() }
    function onMove(x: number, y: number) {
      m.x = x - left; m.y = y - top
      if (!m.set) { m.sx = m.lx = m.x; m.sy = m.ly = m.y; m.set = true }
    }
    const onMouse = (e: MouseEvent) => onMove(e.clientX, e.clientY)
    const onTouch = (e: TouchEvent) => onMove(e.touches[0].clientX, e.touches[0].clientY)

    setSize(); setLines()
    frame = requestAnimationFrame(tick)
    window.addEventListener('resize', onResize)
    window.addEventListener('mousemove', onMouse)
    window.addEventListener('touchmove', onTouch, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouse)
      window.removeEventListener('touchmove', onTouch)
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}
