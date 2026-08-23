/**
 * Предпросмотр чека — проверочный вид.
 *
 * Рисует чек моноширинным шрифтом в сетке фиксированной ширины (32 символа
 * для ленты 58 мм, 48 — для 80 мм). Это и есть смысл проверки: пользователь
 * видит, что адрес не влезает или названия нет, до того как напечатает первый
 * чек. Строки собирает receiptTextLines из тех же данных и тех же
 * форматтеров, что и печатная версия.
 *
 * Ширина берётся из настройки рулона, а не из своего переключателя: рулон один
 * на кассу, и превью обязано показывать именно его. Своё локальное состояние
 * здесь означало бы, что человек проверил чек на 58 мм, а печатается 80 мм.
 */

import { useMemo } from 'react'
import { receiptTextLines } from '../receipt/fiscalBlocks'
import { columnsForRoll } from './types'
import type { OnboardingData } from './types'
import './ReceiptPreview.css'

type Props = {
  data: OnboardingData
}

export function ReceiptPreview({ data }: Props) {
  const columns = columnsForRoll(data.branding.receiptRollWidth)
  const lines = useMemo(() => receiptTextLines(data, columns), [data, columns])

  return (
    <div className="rp">
      <p className="rp__roll">
        Лента {data.branding.receiptRollWidth} мм · {columns} символов в строке. Ширина меняется в
        блоке «Логотип в чеке».
      </p>

      <div className="rp__paper" data-columns={columns}>
        {/* Линейка сверху показывает границу ленты — по ней видно, что текст
            не обрезан, а действительно помещается. */}
        <div className="rp__ruler" aria-hidden="true">
          {'.'.repeat(columns)}
        </div>
        <pre className="rp__text">{lines.join('\n')}</pre>
      </div>
    </div>
  )
}
