/**
 * Выбор картинки системным диалогом.
 *
 * Зачем отдельный путь вместо `<input type="file">`. Диалог, который открывает
 * сам Chromium из страницы, во frameless-окне на Windows возвращает фокус так,
 * что окно остаётся незакрашенным: DOM цел, обработчики живы, а человек видит
 * белый экран и решает, что приложение умерло. Диалог, открытый main-процессом
 * (см. `dialog-pick-image` в electron/ipc/register-ipc.cjs), принадлежит окну
 * как модальное окно приложения, и после закрытия окно перерисовывается
 * принудительно.
 *
 * В обычном браузере (dev без Electron, экран покупателя) моста нет — там
 * остаётся прежний скрытый input, и вызывающий код это учитывает.
 */

export type PickedImage = { file: File | null; error: string }

/** Есть ли мост к системному диалогу. Без него вызывающий рисует input. */
export function nativeImageDialogAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.filesAPI?.pickImage === 'function'
}

/**
 * Открывает диалог и возвращает выбранный файл.
 *
 * Отмена — это не ошибка: `{ file: null, error: '' }`. Проверки расширения и
 * размера сделаны в main-процессе, до чтения файла, поэтому сюда приходит либо
 * годная картинка, либо готовый текст ошибки для показа человеку.
 */
export async function openNativeImageDialog(title?: string): Promise<PickedImage> {
  try {
    const result = await window.filesAPI!.pickImage({ title })
    if (!result || result.canceled) return { file: null, error: '' }
    if (result.error) return { file: null, error: result.error }
    if (!result.bytes) return { file: null, error: 'Файл не прочитался — попробуйте другой.' }
    // Uint8Array из main-процесса — то же самое, что пришло бы из input:
    // дальше по цепочке файл ничем не отличается от выбранного браузером.
    const file = new File([result.bytes], result.name ?? 'image', { type: result.type ?? '' })
    return { file, error: '' }
  } catch {
    return { file: null, error: 'Не удалось открыть окно выбора файла.' }
  }
}
