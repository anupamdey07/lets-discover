import { useState, useRef, useEffect } from 'react'

interface SwipeFlipOptions {
  threshold?: number
  resistance?: number
  edgeOnly?: boolean
  edgeWidth?: number
  maxVelocity?: number // deg/s cap → bounds overshoot on a hard flick
}

/**
 * Drag-to-flip with a velocity-aware spring on release.
 *
 * - While dragging: the card tracks the finger 1:1 (eased, "fluid & light").
 * - On release:
 *     • past threshold → spring toward the opposite face, carrying the
 *       finger's momentum. A strong flick overshoots the target ("goes over")
 *       then settles — a gentle flick barely overshoots.
 *     • below threshold → rubber-band spring back to the current face.
 * - The spring is underdamped, so there's a lively launch and a soft settle
 *   (the "spring at start + pause" character).
 */
export function useSwipeFlip(
  onFlip: () => void,
  flipped: boolean,
  options: SwipeFlipOptions = {}
) {
  const {
    threshold = 140,
    resistance = 1.0,
    edgeOnly = true,
    edgeWidth = 48,
    maxVelocity = 400,
  } = options

  const [dragProgress, setDragProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [animating, setAnimating] = useState(false)
  const [springAngle, setSpringAngle] = useState(0)
  const [velocity, setVelocity] = useState(0) // deg/s — drives motion blur

  const dragStart = useRef<number | null>(null)
  const progressRef = useRef(0) // live progress (ref → no stale closure)
  const flippedRef = useRef(flipped)
  const samples = useRef<{ a: number; t: number }[]>([]) // velocity samples
  const dragRaf = useRef<number | null>(null)
  const springRaf = useRef<number | null>(null)

  flippedRef.current = flipped

  const constrain = (v: number) => Math.max(0, Math.min(1, v))

  const easedDistance = (d: number) => {
    const abs = Math.abs(d)
    return Math.pow(abs / (threshold * 1.5), resistance) * threshold
  }

  // Angle for a given progress + face (0..180 ↔ 180..0)
  const angleFor = (prog: number, fl: boolean) =>
    fl ? 180 - prog * 180 : prog * 180

  // ── Spring integrator (semi-implicit Euler, substepped for stability) ──
  const runSpring = (
    fromAngle: number,
    targetAngle: number,
    v0: number,
    onSettle: () => void
  ) => {
    if (springRaf.current) cancelAnimationFrame(springRaf.current)
    setAnimating(true)
    setDragging(false)
    setSpringAngle(fromAngle) // avoid a 1-frame glitch at spring start

    let x = fromAngle
    let v = v0
    const k = 140 // stiffness
    const c = 18 // damping → ζ ≈ 0.76 (slightly tighter than before, premium feel)
    let last = performance.now()
    let settled = false

    const step = (now: number) => {
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05 // clamp frame gaps (tab switch, etc.)
      const sub = 4
      const h = dt / sub
      for (let i = 0; i < sub; i++) {
        const force = -k * (x - targetAngle) - c * v
        v += force * h
        x += v * h
      }
      setSpringAngle(x)
      // Publish velocity for motion-blur CSS. Math.abs(v) is in deg/s.
      setVelocity(v)
      if (!settled && Math.abs(x - targetAngle) < 0.25 && Math.abs(v) < 3.5) {
        settled = true
        setSpringAngle(targetAngle)
        setVelocity(0)
        setAnimating(false)
        onSettle()
        return
      }
      springRaf.current = requestAnimationFrame(step)
    }
    springRaf.current = requestAnimationFrame(step)
  }

  // Velocity at release (deg/s, signed toward the flip target)
  const releaseVelocity = () => {
    const s = samples.current
    if (s.length < 2) return 0
    const first = s[0]
    const last = s[s.length - 1]
    let dt = last.t - first.t
    if (dt < 1) dt = 1
    let v = ((last.a - first.a) / dt) * 1000
    if (v > maxVelocity) v = maxVelocity
    if (v < -maxVelocity) v = -maxVelocity
    return v
  }

  const handleDragStart = (clientX: number, fromEdge: boolean) => {
    if (edgeOnly && !fromEdge) return
    if (springRaf.current) cancelAnimationFrame(springRaf.current)
    dragStart.current = clientX
    progressRef.current = 0
    const startAngle = flippedRef.current ? 180 : 0
    samples.current = [{ a: startAngle, t: performance.now() }]
    setAnimating(false)
    setVelocity(0)
    setDragging(true)
  }

  const handleDragMove = (clientX: number) => {
    if (dragStart.current == null) return
    const dx = clientX - dragStart.current
    const eased = easedDistance(dx)
    const prog = constrain(eased / threshold)
    progressRef.current = prog
    const a = angleFor(prog, flippedRef.current)
    const t = performance.now()
    samples.current.push({ a, t })
    if (samples.current.length > 6) samples.current.shift()
    // Live finger velocity (deg/s) from the most recent samples — drives
    // motion blur while the user is dragging.
    if (samples.current.length >= 2) {
      const first = samples.current[0]
      const last = samples.current[samples.current.length - 1]
      const dtMs = last.t - first.t
      if (dtMs > 0) {
        const v = ((last.a - first.a) / dtMs) * 1000
        setVelocity(Math.max(-2000, Math.min(2000, v)))
      }
    }
    if (dragRaf.current) cancelAnimationFrame(dragRaf.current)
    dragRaf.current = requestAnimationFrame(() => setDragProgress(prog))
  }

  const handleDragEnd = () => {
    const prog = progressRef.current
    const over = prog >= 0.8
    const v0 = releaseVelocity()
    const fromAngle = angleFor(prog, flippedRef.current)
    // commit → opposite face; cancel → current face
    const target = over
      ? flippedRef.current
        ? 0
        : 180
      : flippedRef.current
        ? 180
        : 0

    dragStart.current = null
    samples.current = []
    if (dragRaf.current) cancelAnimationFrame(dragRaf.current)
    setDragProgress(0)

    // A cancel (rubber-band) gets damped velocity so it doesn't lunge hard
    const initialV = over ? v0 : v0 * 0.5

    runSpring(fromAngle, target, initialV, () => {
      if (over) onFlip()
    })
  }

  // Mouse
  const onMouseDown = (clientX: number, fromEdge: boolean) => {
    handleDragStart(clientX, fromEdge)
    const onMove = (e: MouseEvent) => handleDragMove(e.clientX)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      handleDragEnd()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Touch
  const onTouchStart = (clientX: number, fromEdge: boolean) => {
    handleDragStart(clientX, fromEdge)
    const onMove = (e: TouchEvent) => handleDragMove(e.touches[0].clientX)
    const onEnd = () => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      handleDragEnd()
    }
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
  }

  // Active transform: spring angle while animating, finger while dragging,
  // otherwise the resting face angle. Kept simple — just rotateY. Any
  // translateZ/scale compounds with the rotation matrix and causes
  // visual glitches at the 90° apex.
  const idleAngle = flipped ? 180 : 0
  const angle = animating
    ? springAngle
    : dragging
      ? angleFor(dragProgress, flipped)
      : idleAngle
  const transform = `rotateY(${angle}deg)`

  useEffect(() => {
    return () => {
      if (dragRaf.current) cancelAnimationFrame(dragRaf.current)
      if (springRaf.current) cancelAnimationFrame(springRaf.current)
    }
  }, [])

  // `dragging` is true during both finger-drag and spring animation so the
  // caller can disable the CSS transition (per-frame transform must be exact).
  return {
    transform,
    dragging: dragging || animating,
    angle,
    dragProgress,
    velocity, // deg/s — bind to CSS --flip-velocity for motion blur
    onMouseDown,
    onTouchStart,
  }
}
