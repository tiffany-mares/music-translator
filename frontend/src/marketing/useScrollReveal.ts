import { useEffect } from 'react'

// Ported from the Lovable use-scroll-reveal hook: adds `is-revealed` to every
// `.will-reveal` element as it scrolls into view (styles.css owns the blur+rise
// transition, and forces everything visible under prefers-reduced-motion).
// StrictMode-safe: each effect run owns its observer and disconnects it on
// cleanup. jsdom has no IntersectionObserver — in that case reveal everything
// immediately instead of leaving content permanently invisible.
export function useScrollReveal() {
  useEffect(() => {
    const nodes = document.querySelectorAll('.will-reveal')
    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.classList.add('is-revealed'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-revealed')
            io.unobserve(e.target)
          }
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [])
}
