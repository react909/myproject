// src/right-panel/icons.tsx

type P = { className?: string }

export const IcoShiftOpen   = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
export const IcoShiftClose  = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
export const IcoSettings    = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" stroke="currentColor" strokeWidth="1.9"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 0 1-2.83 2.83 1.65 1.65 0 0 0-1.82.33A1.65 1.65 0 0 0 15 21a2 2 0 0 1-4 0 1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33 2 2 0 0 1-2.83-2.83A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1 2 2 0 0 1 0-4 1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82 2 2 0 0 1 2.83-2.83A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51 2 2 0 0 1 4 0 1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33 2 2 0 0 1 2.83 2.83 1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1 2 2 0 0 1 0 4 1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.7"/></svg>
export const IcoRefresh     = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8M21 4v4h-4M21 12a9 9 0 0 1-15.36 6.36L3 16M3 20v-4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
export const IcoChevDown    = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
export const IcoHold        = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><rect x="6" y="4" width="4" height="16" rx="2" stroke="currentColor" strokeWidth="2"/><rect x="14" y="4" width="4" height="16" rx="2" stroke="currentColor" strokeWidth="2"/></svg>
export const IcoList        = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><circle cx="5" cy="7" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="17" r="1.3" fill="currentColor"/><path d="M9 7h10M9 12h10M9 17h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
export const IcoDiscount    = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="2"/><circle cx="16" cy="16" r="2" stroke="currentColor" strokeWidth="2"/><path d="M17.5 6.5 6.5 17.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
export const IcoRepeat      = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
export const IcoSelect      = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M8.5 12.5 11 15l5-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
export const IcoTrash       = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
export const IcoCheck       = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M6 12.5 10.5 17 18 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
export const IcoClose       = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="m8 8 8 8M16 8 8 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
export const IcoPlus        = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
export const IcoMinus       = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
export const IcoWifiOn      = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
export const IcoWifiOff     = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.8M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M2 2l20 20M10.8 16.51a4 4 0 0 1 2.4 0M12 20h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
export const IcoScale       = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><path d="M12 3a4 4 0 0 1 4 4H8a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="1.9"/><path d="M5 7h14l2 13H3L5 7Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"/><path d="M12 11v5M9.5 13.5h5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>
export const IcoUser        = (p: P) => <svg viewBox="0 0 24 24" fill="none" className={p.className}><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
export const IcoCartEmpty   = (p: P) => <svg viewBox="0 0 64 64" fill="none" className={p.className}><circle cx="24" cy="53" r="4" stroke="#94a3b8" strokeWidth="2.5"/><circle cx="44" cy="53" r="4" stroke="#94a3b8" strokeWidth="2.5"/><path d="M6 8h7l6 30h22l6-22H18" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>

/** Старые имена — для совместимости с компонентами */
export const PlusIcon = IcoPlus
export const MinusIcon = IcoMinus
export const CheckIcon = IcoCheck
export const TrashIcon = IcoTrash
export const CloseIcon = IcoClose
export const HoldIcon = IcoHold
export const ListIcon = IcoList
export const DiscountIcon = IcoDiscount
export const RepeatIcon = IcoRepeat
export const SelectionIcon = IcoSelect
export const ChevronDownIcon = IcoChevDown
export const UserIcon = IcoUser
export const CartEmptyIcon = IcoCartEmpty
export const ShiftOpenIcon = IcoShiftOpen
export const ShiftCloseIcon = IcoShiftClose
export const SettingsIcon = IcoSettings
export const RefreshIcon = IcoRefresh
export const WifiOnIcon = IcoWifiOn
export const WifiOffIcon = IcoWifiOff