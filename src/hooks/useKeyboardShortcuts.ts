import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const PAGE_NEW_ROUTES: Record<string, string> = {
  '/quotations': '/quotations/new',
  '/orders': '/orders/new',
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger when typing in inputs
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        // Only handle Escape in inputs
        if (e.key === 'Escape') {
          target.blur()
        }
        return
      }

      // Ctrl/Cmd + N = context-aware "New"
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        const newRoute = PAGE_NEW_ROUTES[location.pathname]
        if (newRoute) {
          navigate(newRoute)
        }
      }

      // G then shortcuts (go to page) - single key shortcuts
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key) {
          case 'Escape':
            // Close slide-overs / go back
            window.history.back()
            break
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [navigate, location.pathname])
}
