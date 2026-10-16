import { useEffect, useRef } from 'react'

// Marks a horizontally scrolling element with data-more-left/right while there
// is more to see on that side, so CSS can fade the edge as a hint.
export const useScrollEdges = <T extends HTMLElement>() => {
  const ref = useRef<T>(null)

  useEffect(() => {
    const element = ref.current

    if (!element) return

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = element

      element.toggleAttribute('data-more-left', scrollLeft > 2)
      element.toggleAttribute('data-more-right', scrollLeft + clientWidth < scrollWidth - 2)
    }
    const observer = new ResizeObserver(update)

    update()
    element.addEventListener('scroll', update, { passive: true })
    observer.observe(element)

    return () => {
      element.removeEventListener('scroll', update)
      observer.disconnect()
    }
  })

  return ref
}
