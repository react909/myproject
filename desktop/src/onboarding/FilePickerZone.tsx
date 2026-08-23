/**
 * Выбор картинки: своя кнопка и зона перетаскивания.
 *
 * Стандартный `<input type="file">` здесь не используется намеренно. Браузер
 * рисует его системным элементом с надписью «Файл не выбран» — чужим шрифтом,
 * чужого размера, не попадающим ни в тему, ни в плотность интерфейса. На
 * кассовом моноблоке он к тому же мелкий: попасть в него пальцем трудно.
 *
 * В приложении диалог открывает main-процесс (см. imageFileDialog), а input
 * остаётся только запасным путём для обычного браузера. Причина не в красоте:
 * диалог, открытый самой страницей, во frameless-окне на Windows возвращал
 * фокус так, что окно оставалось незакрашенным — тот самый белый экран после
 * нажатия «выбрать логотип».
 */

import { useId, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { nativeImageDialogAvailable, openNativeImageDialog } from '../services/imageFileDialog'
import { reportError } from '../services/reportError'
import './FilePickerZone.css'

type Props = {
  label: string
  hint?: string
  /** Что показать вместо подписи, когда файл уже выбран. */
  fileName?: string
  accept?: string
  disabled?: boolean
  busy?: boolean
  onPick: (file: File) => void
  /**
   * Куда сообщить, что диалог вернул ошибку (файл не читается, слишком
   * большой). Без этого отказ был бы молчаливым: человек выбрал файл, а не
   * произошло ничего.
   */
  onError?: (message: string) => void
}

const DEFAULT_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'

export function FilePickerZone({
  label,
  hint,
  fileName,
  accept = DEFAULT_ACCEPT,
  disabled = false,
  busy = false,
  onPick,
  onError,
}: Props) {
  const inputId = useId()
  const [dragging, setDragging] = useState(false)
  const [opening, setOpening] = useState(false)
  const native = nativeImageDialogAvailable()

  /**
   * Отдаёт выбранный файл наружу, не давая исключению уйти в рендер.
   *
   * Обработчик события — не рендер, и граница ошибок React его не видит:
   * брошенное отсюда исключение всплывает как необработанное. Ловим здесь же.
   */
  const takeFirstImage = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      onPick(file)
    } catch (error) {
      reportError('FilePickerZone.onPick', error, { name: file.name, size: file.size })
      onError?.('Не удалось открыть файл. Попробуйте другой.')
    }
  }

  /** Системный диалог из main-процесса — основной путь в приложении. */
  const openDialog = async () => {
    if (disabled || busy || opening) return
    setOpening(true)
    try {
      const { file, error } = await openNativeImageDialog(label)
      if (error) {
        onError?.(error)
        return
      }
      if (file) onPick(file)
    } catch (error) {
      reportError('FilePickerZone.openDialog', error)
      onError?.('Не удалось открыть окно выбора файла.')
    } finally {
      setOpening(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    if (disabled || busy) return
    takeFirstImage(event.dataTransfer?.files ?? null)
  }

  const dragProps = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      if (!disabled && !busy) setDragging(true)
    },
    onDragLeave: () => setDragging(false),
    onDrop,
  }

  const className = `fpz${dragging ? ' is-dragging' : ''}${
    disabled || busy ? ' is-disabled' : ''
  }`

  const inner = (
    <>
      <span className="fpz__icon" aria-hidden="true">
        {busy || opening ? '…' : '+'}
      </span>
      <span className="fpz__text">
        <b>{busy ? 'Обработка…' : label}</b>
        {fileName ? <small className="fpz__file">{fileName}</small> : hint ? <small>{hint}</small> : null}
      </span>
    </>
  )

  if (native) {
    return (
      <div
        className={className}
        role="button"
        tabIndex={disabled || busy ? -1 : 0}
        aria-disabled={disabled || busy}
        onClick={() => void openDialog()}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          void openDialog()
        }}
        {...dragProps}
      >
        {inner}
      </div>
    )
  }

  return (
    <label htmlFor={inputId} className={className} {...dragProps}>
      {inner}
      <input
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled || busy}
        onChange={(event) => {
          takeFirstImage(event.target.files)
          // Сброс значения: без него повторный выбор того же файла не вызовет
          // onChange, и человек решит, что кнопка сломалась.
          event.target.value = ''
        }}
      />
    </label>
  )
}
