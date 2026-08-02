import { useEffect, useRef } from 'react'

type Particle = {
  x: number
  y: number
  size: number
  speed: number
  sway: number
  phase: number
  glyph: string
  brass: boolean
}

const GLYPHS = ['♪', '♫', '♩', '♬']
const COUNT = 26

// Recompile's petal-drift, transposed: faint note glyphs drifting slowly
// upward with a sine sway, brass and sage at low alpha. Decorative only
// (aria-hidden, pointer-events none). Skips entirely under reduced motion or
// when canvas 2d is unavailable (jsdom); pauses in hidden tabs via the rAF
// loop simply not being driven.
export default function NoteDrift({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      return
    const ctx = canvas.getContext?.('2d')
    if (!ctx) return

    let raf = 0
    let particles: Particle[] = []

    const seed = (w: number, h: number): Particle => ({
      x: Math.random() * w,
      y: h + Math.random() * h,
      size: 10 + Math.random() * 16,
      speed: 6 + Math.random() * 14,
      sway: 10 + Math.random() * 22,
      phase: Math.random() * Math.PI * 2,
      glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
      brass: Math.random() < 0.6,
    })

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth: w, clientHeight: h } = canvas
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      particles = Array.from({ length: COUNT }, () => seed(w, h))
    }
    resize()
    // ResizeObserver, not window resize: a hidden/backgrounded tab can mount
    // at 0x0 and would otherwise stay blank until a window resize.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    observer?.observe(canvas)
    window.addEventListener('resize', resize)

    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)
      const styles = getComputedStyle(canvas)
      const brass = styles.getPropertyValue('--brass').trim() || 'oklch(0.78 0.125 78)'
      const sage = styles.getPropertyValue('--sage').trim() || 'oklch(0.76 0.06 152)'
      for (const p of particles) {
        p.y -= p.speed * dt
        p.phase += dt * 0.9
        if (p.y < -p.size) Object.assign(p, seed(w, h), { y: h + p.size })
        ctx.globalAlpha = 0.16
        ctx.fillStyle = p.brass ? brass : sage
        ctx.font = `${p.size}px serif`
        ctx.fillText(p.glyph, p.x + Math.sin(p.phase) * p.sway, p.y)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  )
}
