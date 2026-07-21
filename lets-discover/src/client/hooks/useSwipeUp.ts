import { useState, useRef, useEffect, useCallback } from 'react'

interface SwipeUpOptions {
  /** px height of the peek state (handle + one-line summary) */
  peekHeight?: number
  /** fraction of viewport height the sheet opens to when expanded */
  openRatio?: number
  /** drag threshold (px) past which a release commits the toggle */
  threshold?: number
  /** max velocity (px/s) carried into the settle spring */
  maxVelocity?: number
}

/**
 * Bottom-anchored sheet that peeks a slim handle and swipes up to reveal.
 *
 * - `collapsed` → only `peekHeight` is visible (handle + summary teaser).
 * - drag up past `threshold` (or a tap on the handle) → springs open.
 * - drag down past `threshold` → springs back to peek.
 * - a hard flick carries momentum into the spring (overshoots slightly).
 *
 * `translateY` is the px offset from the bottom; the consumer applies it via
 * `transform: translateY(translateY)` and sets `height` to the open height.
 */
export function useSwipeUp(options: SwipeUpOptions = {}) {
  const {
    peekHeight = 52,
    openRatio = 0.72,
    threshold = 60,
    maxVelocity = 2200,
  } = options

  const [collapsed, setCollapsed] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [animating, setAnimating] = useState(false)
  // translateY in px (0 = fully open; openHeight - peekHeight = peeked)
  const [translateY, setTranslateY] = useState(0)
  const [vh, setVh] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 800
  )
  const [visualHeight, setVisualHeight] = useState(vh)

  const openHeight = Math.round(Math.min(vh, visualHeight) * openRatio)
  const peekY = openHeight - peekHeight // rest offset when collapsed

  const collapsedRef = useRef(true)
  const startYRef = useRef<number | null>(null)
  const startTranslateRef = useRef(0)
  const samples = useRef<{ y: number; t: number }[]>([])
  const dragRaf = useRef<number | null>(null)
  const springRaf = useRef<number | null>(null)
  const yRef = useRef(0) // live translate (ref → no stale closure)

  collapsedRef.current = collapsed

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight)
    window.addEventListener('resize', onResize)

    // Use visual viewport when available so the sheet respects the
    // on-screen keyboard and other chrome on mobile.
    const vv = (window as any).visualViewport
    if (vv) {
      const onVV = () => setVisualHeight(Math.round(vv.height))
      vv.addEventListener('resize', onVV)
      onVV()
      return () => {
        window.removeEventListener('resize', onResize)
        vv.removeEventListener('resize', onVV)
      }
    }
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Re-clamp resting translate if viewport changes
  useEffect(() => {
    if (!dragging && !animating) {
      setTranslateY(collapsedRef.current
        ? Math.round(Math.min(vh, visualHeight) * openRatio) - peekHeight
        : 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vh, visualHeight])

  // ── Spring (semi-implicit Euler, substepped) ──
  const runSpring = (
    from: number,
    target: number,
    v0: number,
    onSettle: () => void
  ) => {
    if (springRaf.current) cancelAnimationFrame(springRaf.current)
    setAnimating(true)
    setDragging(false)
    setTranslateY(from)
    let x = from
    let v = v0
    const k = 600
    const c = 42 // ζ ≈ 0.86 → crisp, minimal overshoot
    let last = performance.now()
    let settled = false
    const step = (now: number) => {
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05
      const sub = 4
      const h = dt / sub
      for (let i = 0; i < sub; i++) {
        const force = -k * (x - target) - c * v
        v += force * h
        x += v * h
      }
      setTranslateY(x)
      if (!settled && Math.abs(x - target) < 1 && Math.abs(v) < 10) {
        settled = true
        setTranslateY(target)
        setAnimating(false)
        onSettle()
        return
      }
      springRaf.current = requestAnimationFrame(step)
    }
    springRaf.current = requestAnimationFrame(step)
  }

  const releaseVelocity = (direction: number) => {
    const s = samples.current
    if (s.length < 2) return 0
    const first = s[0]
    const last = s[s.length - 1]
    let dt = last.t - first.t
    if (dt < 1) dt = 1
    let v = ((last.y - first.y) / dt) * 1000 * direction
    if (v > maxVelocity) v = maxVelocity
    if (v < -maxVelocity) v = -maxVelocity
    return v
  }

  const open = useCallback(() => {
    setCollapsed(false)
    runSpring(yRef.current, 0, releaseVelocity(1) * 0.5, () => {})
  }, [])

  const close = useCallback(() => {
    runSpring(yRef.current, peekY, releaseVelocity(-1) * 0.5, () => {
      setCollapsed(true)
    })
  }, [peekY])

  const toggle = useCallback(() => {
    if (collapsedRef.current) open()
    else close()
  }, [open, close])

  // ── Pointer-agnostic entry: starts the drag AND wires window move/end
  //    listeners, so the consumer only needs to call this on pointerdown. ──
  const onPointerDown = (clientY: number) => {
    if (springRaf.current) cancelAnimationFrame(springRaf.current)
    startYRef.current = clientY
    startTranslateRef.current = yRef.current
    samples.current = [{ y: clientY, t: performance.now() }]
    setAnimating(false)
    setDragging(true)

    const onMove = (e: MouseEvent) => onDragMove(e.clientY)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onDragEnd()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onTouchPointerDown = (clientY: number) => {
    if (springRaf.current) cancelAnimationFrame(springRaf.current)
    startYRef.current = clientY
    startTranslateRef.current = yRef.current
    samples.current = [{ y: clientY, t: performance.now() }]
    setAnimating(false)
    setDragging(true)

    const onMove = (e: TouchEvent) => onDragMove(e.touches[0].clientY)
    const onEnd = () => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      onDragEnd()
    }
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
  }

  const onDragMove = (clientY: number) => {
    if (startYRef.current == null) return
    const dy = clientY - startYRef.current
    // target translate = start + dy (drag down increases translateY)
    let target = startTranslateRef.current + dy
    if (target < 0) target = 0 // can't drag above fully-open
    const maxY = peekY + peekHeight // a bit of rubber-band below peek
    if (target > maxY) target = maxY
    yRef.current = target
    const t = performance.now()
    samples.current.push({ y: clientY, t })
    if (samples.current.length > 6) samples.current.shift()
    if (dragRaf.current) cancelAnimationFrame(dragRaf.current)
    dragRaf.current = requestAnimationFrame(() => setTranslateY(target))
  }

  const onDragEnd = () => {
    const dy = yRef.current - startTranslateRef.current
    startYRef.current = null
    if (dragRaf.current) cancelAnimationFrame(dragRaf.current)
    setDragging(false)
    const currentlyCollapsed = collapsedRef.current

    // Treat a tiny movement as a tap → toggle.
    const tapThreshold = 5
    if (Math.abs(dy) < tapThreshold) {
      if (currentlyCollapsed) open()
      else close()
      samples.current = []
      return
    }

    // Otherwise use swipe logic.
    const shouldToggle = currentlyCollapsed
      ? dy < -threshold
      : dy > threshold
    if (shouldToggle) {
      if (currentlyCollapsed) open()
      else close()
    } else {
      // snap back to current rest
      runSpring(yRef.current, currentlyCollapsed ? peekY : 0, 0, () => {})
    }
    samples.current = []
  }

  // keep yRef in sync when not dragging (springs / viewport changes)
  useEffect(() => {
    if (!dragging) yRef.current = translateY
  }, [translateY, dragging])

  useEffect(() => {
    return () => {
      if (dragRaf.current) cancelAnimationFrame(dragRaf.current)
      if (springRaf.current) cancelAnimationFrame(springRaf.current)
    }
  }, [])

  return {
    collapsed,
    openHeight,
    peekHeight,
    translateY,
    dragging: dragging || animating,
    onPointerDown,
    onTouchPointerDown,
    toggle,
    open,
    close,
  }
}
