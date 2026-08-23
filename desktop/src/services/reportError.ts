/**
 * Единая точка, куда уходят ошибки интерфейса.
 *
 * Пишет и в консоль, и в файл лога. Второе — не дублирование: DevTools на
 * кассе никто не открывает, и до появления этой функции о падении узнавали в
 * пересказе, без текста ошибки и стека. Логи собираются в архив кнопкой в
 * диагностике и уходят разработчику как есть.
 *
 * Сама функция не бросает ни при каких обстоятельствах: обработчик ошибок,
 * способный уронить приложение, — худшее, что можно сюда положить.
 */

// Тип моста logsAPI объявлен один раз, в src/types/electron.d.ts. Повторять
// его здесь нельзя: объявление в этом файле перетёрло бы соседние поля моста,
// и `archive` перестал бы существовать для TypeScript.
type LogMeta = Record<string, unknown>

/** Читаемый текст ошибки: у Error берём message, у остального — строку. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function reportError(scope: string, error: unknown, meta: LogMeta = {}): void {
  const message = errorText(error)
  const stack = error instanceof Error ? error.stack : undefined

  try {
    console.error(`[${scope}]`, error)
  } catch {
    /* консоль недоступна — не повод падать */
  }

  try {
    void window.logsAPI?.append?.('error', `${scope}: ${message}`, { ...meta, stack })
  } catch {
    /* вне Electron моста нет — остаётся консоль */
  }
}

/**
 * Ловит то, что не поймал ни один ErrorBoundary: ошибки в промисах и в
 * обработчиках событий. Граница React их не видит — она перехватывает только
 * ошибки рендера.
 */
export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (event) => {
    reportError('window.onerror', event.error ?? event.message, {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportError('unhandledrejection', event.reason)
  })
}
