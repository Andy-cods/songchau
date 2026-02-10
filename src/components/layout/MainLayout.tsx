import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import CommandPalette from './CommandPalette'

export default function MainLayout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // Global keyboard shortcut for Command Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      {/* Command Palette */}
      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />

      {/* Sidebar - Fixed */}
      <Sidebar />

      {/* Main Content Area - With left margin for sidebar */}
      <div className="ml-[260px] min-h-screen bg-slate-900">
        {/* Header */}
        <Header />

        {/* Page Content */}
        <main className="p-8">
          <div className="page-transition">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  )
}
