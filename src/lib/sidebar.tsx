'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { SIDEBAR_STORAGE_KEY } from './theme-constants'

const MOBILE_QUERY = '(max-width: 767px)'

interface SidebarContextValue {
  /** Desktop: rail is collapsed to the 3rem icon strip. */
  collapsed: boolean
  toggleCollapsed: () => void
  /** Viewport is below the mobile breakpoint — rail becomes an off-canvas drawer. */
  isMobile: boolean
  /** Drawer open (mobile only). */
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  /** One control the top-bar trigger calls: toggles the drawer on mobile, the rail otherwise. */
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

function persist(collapsed: boolean) {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded') } catch {}
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed') setCollapsed(true)
    } catch {}

    const mql = window.matchMedia(MOBILE_QUERY)
    setIsMobile(mql.matches)
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
      if (!e.matches) setMobileOpen(false)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(c => { persist(!c); return !c })
  }, [])

  const toggle = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches) {
      setMobileOpen(o => !o)
    } else {
      setCollapsed(c => { persist(!c); return !c })
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const value: SidebarContextValue = {
    collapsed, toggleCollapsed,
    isMobile, mobileOpen, setMobileOpen, toggle,
  }
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider')
  return ctx
}
