/**
 * Блок «Информация о кассе».
 *
 * Две вещи, которых не должно быть в форме руками. Первая — заводской и
 * регистрационный номера: их переписывают с шильдика и ошибаются, поэтому
 * сначала спрашиваем у самой кассы, а поля запираем. Вторая — версии ФФД и
 * ПО: это свойства прошивки, вводить их бессмысленно, поэтому они показаны
 * серым текстом и не редактируются нигде.
 */

import { useState } from 'react'
import { readKkmRegistration } from '../services/devices/kkm.client'
import { FFD_VERSION, SW_VERSION } from './types'
import type { KkmData } from './types'
import './KkmInfoBlock.css'

type Props = {
  kkm: KkmData
  onChange: (patch: Partial<KkmData>) => void
  /** Номера считаны с устройства — поля заперты, править их можно только явно. */
  locked: boolean
  onLockedChange: (locked: boolean) => void
}

type Status = { tone: 'ok' | 'warn'; text: string } | null

export function KkmInfoBlock({ kkm, onChange, locked, onLockedChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const read = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await readKkmRegistration()
      if (!result.ok) {
        setStatus({
          tone: 'warn',
          text: `${result.message} Заполните номера вручную — они на шильдике кассы.`,
        })
        return
      }

      // Подставляем только то, что касса действительно сообщила: пустое поле
      // ответа не должно затирать уже введённое значение.
      const patch: Partial<KkmData> = {}
      for (const key of [
        'serialNumber',
        'registrationNumber',
        'fiscalModule',
        'ffdVersion',
        'swVersion',
      ] as const) {
        const value = result.data[key]?.trim()
        if (value) patch[key] = value
      }
      onChange(patch)
      onLockedChange(true)
      setStatus({
        tone: 'ok',
        text: `Считано с кассы: ${result.port} (${result.protocol}). Поля заполнены и заблокированы.`,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kkm">
      <div className="kkm__actions">
        <button type="button" className="kkm__btn kkm__btn--primary" onClick={() => void read()} disabled={busy}>
          {busy ? 'Опрашиваем кассу…' : 'Считать с кассы'}
        </button>
        {locked && (
          <button type="button" className="kkm__btn" onClick={() => onLockedChange(false)}>
            Ввести вручную
          </button>
        )}
      </div>

      <dl className="kkm__firmware">
        <div>
          <dt>Версия ФФД</dt>
          <dd>{kkm.ffdVersion || '—'}</dd>
        </div>
        <div>
          <dt>Версия ПО</dt>
          <dd>{kkm.swVersion || '—'}</dd>
        </div>
      </dl>

      {status ? (
        <small className={`ob-hint${status.tone === 'ok' ? ' is-valid' : ' is-invalid'}`}>{status.text}</small>
      ) : (
        <small className="ob-hint">
          {kkm.ffdVersion === FFD_VERSION && kkm.swVersion === SW_VERSION
            ? 'Версии показаны по умолчанию для этой сборки. Реальные придут от кассы после чтения.'
            : 'Версии прочитаны из прошивки кассы и не редактируются.'}
        </small>
      )}
    </div>
  )
}
