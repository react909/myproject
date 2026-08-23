export function SearchIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
        <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function XIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function WeightIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8.5 7.5A3.5 3.5 0 0 1 15.5 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="M5.5 9.5h13l1.8 8.5A1.8 1.8 0 0 1 18.5 20H5.5a1.8 1.8 0 0 1-1.8-2L5.5 9.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="14" r="1.5" fill="currentColor" />
        <path d="M12 12.5v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function PieceIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3L19.5 7.5V16.5L12 21L4.5 16.5V7.5L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 3v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4.5 7.5L12 12L19.5 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    )
  }
  
  export function BackspaceIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21 6H8L2 12L8 18H21V6Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M16 10L12 14M12 10L16 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function ScalesIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M5 21h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 9H4L2 15c0 1.1 1.34 2 3 2s3-.9 3-2L6 9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M16 9h4l2 6c0 1.1-1.34 2-3 2s-3-.9-3-2l2-6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 9l4-6 4 6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  }
  
  export function CheckmarkIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12L10 17L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  
  export function PlusIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function CartIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16 10a4 4 0 01-8 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function TrashIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 6h18M19 6l-1 14H6L5 6M9 6V4h6v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function BarcodeIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M2 5v14M6 5v14M11 5v14M16 5v14M20 5v14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M4 5v14M8 5v10M13 5v10M18 5v14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function MinusIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function ReceiptIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 2h16v22l-3-2-3 2-3-2-3 2-4-3V2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  }
  
  export function SignalIcon({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M1 6C4.7 2.3 10.6 2 14.7 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4.5 9.5C7.2 6.8 11.5 6.5 14.5 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 13c1.5-1.5 3.8-1.8 5.5-.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.5" fill="currentColor" />
      </svg>
    )
  }
  