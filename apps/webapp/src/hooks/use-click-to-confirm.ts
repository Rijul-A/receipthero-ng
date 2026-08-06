import { useEffect, useRef, useState } from 'react'

/**
 * Two-click confirmation for a destructive action, in place of a separate
 * confirm dialog: first click arms it (caller re-labels the button, e.g.
 * "Confirm?"), a second click within `timeoutMs` runs `action`. If the
 * second click doesn't come in time, it silently disarms - no explicit
 * cancel needed.
 */
export function useClickToConfirm(action: () => void, timeoutMs = 3000) {
  const [confirming, setConfirming] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleClick = () => {
    if (confirming) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      setConfirming(false)
      action()
      return
    }
    setConfirming(true)
    timeoutRef.current = setTimeout(() => setConfirming(false), timeoutMs)
  }

  return { confirming, handleClick }
}
