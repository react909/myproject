import { useRef } from 'react'
import './SearchBar.css'

type SearchBarProps = {
  value: string
  onChange: (value: string) => void
  onFocus?: (el: HTMLInputElement) => void
}

function IconSearch() {
  return (
    <svg className="searchbar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function IconClear() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function SearchBar({ value, onChange, onFocus }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleClear() {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className="searchbar">
      <IconSearch />
      <input
        ref={inputRef}
        className="searchbar__input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск товара или штрихкода"
        autoComplete="off"
        spellCheck={false}
        onFocus={(e) => onFocus?.(e.currentTarget)}
        aria-label="Поиск товара"
      />
      {value.length > 0 && (
        <button
          className="searchbar__clear"
          type="button"
          onClick={handleClear}
          aria-label="Очистить поиск"
          tabIndex={-1}
        >
          <IconClear />
        </button>
      )}
    </div>
  )
}