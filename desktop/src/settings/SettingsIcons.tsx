import type { SVGProps } from 'react'

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.65,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
})

export function IconSidebarConnection(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M8 3v3M16 3v3" />
      <rect x="4" y="6" width="16" height="11" rx="2" />
      <path d="M9 17v4M15 17v4M8 21h8" />
      <path d="M10 10h4" />
    </svg>
  )
}

export function IconSidebarScale(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 2v3" />
      <path d="M6 5h12" />
      <path d="M6 5L4 16h5L6 5zM18 5l2 11h-5L18 5z" />
      <path d="M5 16h14" />
      <path d="M9 22h6" />
    </svg>
  )
}

export function IconSidebarPrinter(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  )
}

export function IconSidebarDisplay(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

export function IconSidebarSystem(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

export function IconSidebarUpdates(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-9-9" />
      <path d="M21 12H12" />
      <path d="M3 12a9 9 0 0 1 9-9" />
      <path d="M3 12h9" />
    </svg>
  )
}

export function IconSidebarUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.3 2.5-5.6 5.5-5.6s5.5 2.3 5.5 5.6" />
      <path d="M16.5 9.2a2.8 2.8 0 1 0 0-5.6" />
      <path d="M18.5 14.6c2 .5 3.5 2.5 3.5 5.4" />
    </svg>
  )
}

export function IconSidebarDiagnostics(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 19v-7M9 19V9M14 19v-4M19 19V5" />
    </svg>
  )
}

export function IconChevronLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ ...props, width: 18, height: 18 })}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

export function IconSavedCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ ...props, width: 14, height: 14 })}>
      <path d="M20 6L9 17l-5-5" strokeWidth={2} />
    </svg>
  )
}

export function IconBookNote(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base({ ...props, width: 26, height: 26 })}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-20H6.5A2.5 2.5 0 0 0 4 4.5z" />
      <path d="M8 7h8M8 11h5" />
    </svg>
  )
}
