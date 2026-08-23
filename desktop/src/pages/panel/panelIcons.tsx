/**
 * Значки разделов панели.
 *
 * Требование к виду одно и жёсткое: тонкие однотонные штриховые, одного
 * размера, без заливок и без цвета. Поэтому здесь нет ни `fill`, ни
 * `linearGradient`, ни эмодзи — только `stroke="currentColor"`, и цвет значок
 * берёт от кнопки. На активном разделе он станет акцентным вместе с надписью,
 * на остальных — нейтральным, и отдельного правила для этого не нужно.
 *
 * Все на одной сетке 16×16 с толщиной штриха 1.5. Разнобой в толщине заметнее
 * разнобоя в форме: ряд из значков разной плотности выглядит собранным из
 * чужих наборов.
 */

type Props = { className?: string }

const BASE = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** Журнал чеков — лента с оторванным низом. */
export function IcoReceipts({ className }: Props) {
  return (
    <svg {...BASE} className={className}>
      <path d="M3.5 2h9v12l-1.8-1.2L9 14l-1.7-1.2L5.5 14l-2-1.3z" />
      <path d="M6 5.5h4M6 8.5h4" />
    </svg>
  )
}

/** Отчёт товаров — столбцы. */
export function IcoReport({ className }: Props) {
  return (
    <svg {...BASE} className={className}>
      <path d="M2.5 13.5h11" />
      <path d="M4.5 13.5v-4M8 13.5V4M11.5 13.5V7.5" />
    </svg>
  )
}

/** Добавить товар — коробка с плюсом. */
export function IcoAddProduct({ className }: Props) {
  return (
    <svg {...BASE} className={className}>
      <path d="M8 2 2.5 4.8v6.4L8 14l5.5-2.8V4.8z" />
      <path d="M2.5 4.8 8 7.6l5.5-2.8M8 7.6V14" />
    </svg>
  )
}

/** Смена — циферблат: смену открывают и закрывают по времени. */
export function IcoShift({ className }: Props) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.6V8l2.4 1.6" />
    </svg>
  )
}

/** Закупка — коробка со стрелкой внутрь: товар приезжает. */
export function IcoPurchase({ className }: Props) {
  return (
    <svg {...BASE} className={className}>
      <path d="M2.5 8.5v4.2a.8.8 0 0 0 .8.8h9.4a.8.8 0 0 0 .8-.8V8.5" />
      <path d="M8 2v6.5M5.6 6.2 8 8.6l2.4-2.4" />
    </svg>
  )
}

/** Поставщики — фургон. */
export function IcoSuppliers({ className }: Props) {
  return (
    <svg {...BASE} className={className}>
      <path d="M1.5 4.5h7.2v6.2H1.5z" />
      <path d="M8.7 6.6h2.6l2.2 2.2v1.9H8.7z" />
      <circle cx="4.4" cy="11.6" r="1.4" />
      <circle cx="11.3" cy="11.6" r="1.4" />
    </svg>
  )
}
