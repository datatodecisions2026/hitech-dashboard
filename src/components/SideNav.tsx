'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

const D = { amber: '#d4a040', sub: '#504e54' }

const IconHome = () => <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>
const IconChart = () => <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="6"/><line x1="18" y1="20" x2="18" y2="15"/></svg>
const IconTruck = () => <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="6" width="14" height="11"/><path d="M15 9h4l3 3v5h-7z"/><circle cx="6" cy="19" r="2"/><circle cx="17.5" cy="19" r="2"/></svg>
const IconPeople = () => <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>

const NAV_ITEMS = [
  { label: 'Dashboard',  href: '/dashboard',  icon: IconHome },
  { label: 'Progress',   href: '/progress',   icon: IconChart },
  { label: 'Machines',   href: '/machines',   icon: IconTruck },
  { label: 'Personnel',  href: '/personnel',  icon: IconPeople },
]

function NavItem({ href, label, Icon, isActive }: { href: string; label: string; Icon: () => React.ReactElement; isActive: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <a href={href} title={label} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: 44, height: 44, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isActive ? '#0e0e10' : hov ? D.amber : D.sub,
        background: isActive ? D.amber : hov ? 'rgba(212,160,64,0.1)' : 'transparent',
        boxShadow: isActive ? '0 0 18px rgba(212,160,64,0.35), inset 0 1px 0 rgba(255,255,255,0.2)' : 'none',
        transform: hov && !isActive ? 'translateY(-1px)' : 'translateY(0)',
        textDecoration: 'none', transition: 'background 0.2s, color 0.2s, transform 0.2s, box-shadow 0.2s',
      }}>
      <Icon/>
    </a>
  )
}

export default function SideNav() {
  const pathname = usePathname()
  if (pathname === '/login') return null

  return (
    <nav className="side-nav" style={{
      position: 'sticky', top: 52, alignSelf: 'flex-start', height: 'calc(100vh - 52px)',
      width: 64, flexShrink: 0, background: '#161618',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      boxShadow: '2px 0 12px rgba(0,0,0,0.4)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 6, padding: '18px 0', zIndex: 60,
    }}>
      {NAV_ITEMS.map(item => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
        return <NavItem key={item.href} href={item.href} label={item.label} Icon={item.icon} isActive={isActive}/>
      })}

      <style>{`
        @media (max-width: 900px) { .side-nav { width: 52px !important; } }
        @media (max-width: 640px) { .side-nav { display: none !important; } }
      `}</style>
    </nav>
  )
}
