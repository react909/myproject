/**
 * Логотип в интерфейсе — шапка приложения и экран покупателя.
 *
 * Отдельно от логотипа в чеке: это разные носители, разные пропорции и разные
 * решения владельца. Здесь всё, что видно на экране; печать настраивается
 * своим блоком (ReceiptLogoEditor) и своей обрезкой.
 *
 * Загружается только знак, без надписи. Название магазина рисует само
 * приложение текстом рядом со знаком — раньше его запекали в картинку, и в
 * шапке выходило два названия подряд: одно нарисованное, другое напечатанное
 * интерфейсом.
 *
 * Три способа получить знак: загрузить файл и обрезать его общим редактором
 * (ImageCropper — тот же, что у QR), собрать монограмму из шаблона или обойтись
 * без картинки. На выходе — готовые размеры разом (512/128/64), потому что
 * пережимать логотип на каждом экране заново значит получить три разных
 * логотипа.
 */

import { useCallback, useState } from 'react'
import { nativeImageDialogAvailable, openNativeImageDialog } from '../services/imageFileDialog'
import { reportError } from '../services/reportError'
import {
  MONOGRAM_STYLES,
  buildLogoVariants,
  imageFileProblem,
  initialsFrom,
  renderMonogram,
  shrinkOversizedImage,
} from './logoCanvas'
import type { MonogramStyle } from './logoCanvas'
import { ImageCropper } from './ImageCropper'
import type { CropResult } from './ImageCropper'
import { HeaderStripPreview, headerBrandView } from '../layout/HeaderBrand'
import type { HeaderBrandView } from '../layout/HeaderBrand'
import { headerLayoutParts } from './types'
import type { BrandingData, LogoMode } from './types'
import './LogoStudio.css'

/** Больше этого сжимаем сами, а не отказываем: см. shrinkOversizedImage. */
const SHRINK_ABOVE_BYTES = 5 * 1024 * 1024

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'

type Props = {
  branding: BrandingData
  /** Из названий компании и точки — подставляется в монограмму и в превью. */
  suggestedName: string
  onChange: (patch: Partial<BrandingData>) => void
  onError: (message: string) => void
}

const MODE_TABS: { id: LogoMode; label: string }[] = [
  { id: 'image', label: 'Свой файл' },
  { id: 'monogram', label: 'Шаблон' },
  { id: 'none', label: 'Без логотипа' },
]

export function LogoStudio({ branding, suggestedName, onChange, onError }: Props) {
  // Исходник храним отдельно от результата: обрезку можно переделать, не
  // теряя качество из-за повторного кропа уже обрезанной картинки.
  const [sourceImage, setSourceImage] = useState('')
  const [cropOpen, setCropOpen] = useState(false)
  const [monogramStyle, setMonogramStyle] = useState<MonogramStyle>('gradient')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const monogram = initialsFrom(suggestedName)
  const activeTab: LogoMode = branding.mode === 'image_text' ? 'image' : branding.mode

  const pickFile = async (file?: File) => {
    if (!file) return
    // Проверка до обработки: чужой или пустой файл дальше по цепочке даёт
    // исключение уже внутри canvas, где объяснить его человеку нечем.
    const fileProblem = imageFileProblem(file)
    if (fileProblem) {
      setProblem(fileProblem)
      return
    }
    setProblem('')
    setBusy(true)
    try {
      // Большой файл ужимаем, а не выдаём ошибку: снимок логотипа с телефона
      // легко весит 8 МБ, и отказ читается как «программа не работает».
      const source = await shrinkOversizedImage(file, file.size > SHRINK_ABOVE_BYTES ? 1600 : 2048)
      setSourceImage(source)
      setCropOpen(true)
    } catch (caught) {
      reportError('LogoStudio.pickFile', caught, { name: file.name, size: file.size })
      setProblem(caught instanceof Error ? caught.message : 'Не удалось открыть изображение.')
    } finally {
      setBusy(false)
    }
  }

  /** Системный диалог из main-процесса — основной путь, см. imageFileDialog. */
  const pickViaDialog = async () => {
    const { file, error } = await openNativeImageDialog('Логотип для интерфейса')
    if (error) {
      setProblem(error)
      return
    }
    if (file) await pickFile(file)
  }

  /** Собирает экранные размеры из готового знака. */
  const publish = useCallback(
    async (mark: string, patch: Partial<BrandingData> = {}) => {
      const variants = await buildLogoVariants(mark)
      // Знак и его размеры — одно и то же изображение: подпись в картинку не
      // запекается, её рисует интерфейс.
      onChange({ ...patch, logo: variants.s512, logoMark: mark, logoVariants: variants })
    },
    [onChange],
  )

  const applyCrop = async ({ image, shape }: CropResult) => {
    await publish(image, { mode: 'image', logoShape: shape })
  }

  const applyMonogram = async (color: string, style: MonogramStyle) => {
    setBusy(true)
    try {
      setMonogramStyle(style)
      const mark = renderMonogram(monogram, color, style)
      await publish(mark, { mode: 'monogram', primaryColor: color })
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Не удалось собрать монограмму.')
    } finally {
      setBusy(false)
    }
  }

  const switchTab = (mode: LogoMode) => {
    if (mode === 'none') {
      onChange({
        mode: 'none',
        logo: '',
        logoMark: '',
        logoVariants: { s512: '', s128: '', s64: '', receipt: '' },
      })
      return
    }
    if (mode === 'monogram') {
      void applyMonogram(branding.primaryColor, monogramStyle)
      return
    }
    onChange({ mode: 'image' })
  }

  /* Название в превью шапки приходит из бренда (см. headerBrandView), поэтому
     своей строки здесь больше нет. `suggestedName` остался ради монограммы:
     её инициалы берутся из названия торговой точки. */

  /**
   * Шапка с подставленным знаком — для предпросмотра обрезки.
   *
   * Компоновка может знака и не показывать (единая картинка, только надпись), а
   * обрезать вслепую нельзя: на время предпросмотра знак встаёт рядом с
   * надписью, чтобы результат обрезки был виден.
   */
  const viewWithMark = (mark: string): HeaderBrandView => {
    const view = headerBrandView(branding)
    if (headerLayoutParts(view.layout).mark) return { ...view, mark }
    return { ...headerBrandView({ ...branding, headerLayout: 'mark_left' }), mark }
  }

  return (
    <div className="ls-studio">
      <div className="ls-studio__main">
        <label className="ls-check ls-check--switch">
          <input
            type="checkbox"
            checked={branding.uiLogo}
            onChange={(event) => onChange({ uiLogo: event.target.checked })}
          />
          <span>
            <strong>Показывать логотип в шапке приложения</strong>
            <small>И на экране, повёрнутом к покупателю. На печать чека не влияет</small>
          </span>
        </label>

        <div className="ls-tabs" role="tablist" aria-label="Источник логотипа">
          {MODE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`ls-tab${activeTab === tab.id ? ' is-active' : ''}`}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'image' && (
          <div className="ls-panel">
            <div className="ls-actions">
              {/* Диалог открывает main-процесс; скрытый input остаётся только
                  для обычного браузера — см. imageFileDialog. */}
              {nativeImageDialogAvailable() ? (
                <button
                  type="button"
                  className={`ls-btn ls-btn--primary${busy ? ' is-busy' : ''}`}
                  disabled={busy}
                  onClick={() => void pickViaDialog()}
                >
                  {busy ? 'Обработка…' : branding.logo ? 'Выбрать другой файл' : 'Выбрать файл'}
                </button>
              ) : (
                <label className={`ls-btn ls-btn--primary${busy ? ' is-busy' : ''}`}>
                  {busy ? 'Обработка…' : branding.logo ? 'Выбрать другой файл' : 'Выбрать файл'}
                  <input
                    type="file"
                    accept={ACCEPT}
                    onChange={(event) => {
                      void pickFile(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                </label>
              )}
              {(sourceImage || branding.logoMark) && (
                <button
                  type="button"
                  className="ls-btn ls-btn--ghost"
                  onClick={() => {
                    if (!sourceImage) setSourceImage(branding.logoMark)
                    setCropOpen(true)
                  }}
                >
                  Обрезать заново
                </button>
              )}
            </div>
            {problem && (
              <p className="ls-error" role="alert">
                {problem}
              </p>
            )}
            <p className="ls-note">
              <strong>Загружайте логотип без надписи — название добавим сами.</strong> Название
              магазина берётся из реквизитов и печатается рядом со знаком текстом: так оно остаётся
              чётким на любом экране и не двоится.
            </p>
            <p className="ls-note">
              PNG, JPG, WebP или SVG. Файл больше 5 МБ уменьшается автоматически. В редакторе
              обрезки есть автоматическая обрезка полей и круглая форма знака.
            </p>
          </div>
        )}

        {activeTab === 'monogram' && (
          <div className="ls-panel">
            <span className="ls-field-label">Начертание</span>
            <div className="ls-styles">
              {MONOGRAM_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  className={`ls-style${monogramStyle === style.id ? ' is-active' : ''}`}
                  onClick={() => void applyMonogram(branding.primaryColor, style.id)}
                >
                  {style.label}
                </button>
              ))}
            </div>
            <p className="ls-note">
              Монограмма «{monogram}» собирается из названия. Цвет берётся из акцента магазина.
            </p>
          </div>
        )}

        {activeTab === 'none' && (
          <div className="ls-panel">
            <p className="ls-note">
              В шапке останется только название магазина. Настройку чека это не затрагивает — знак
              можно продолжать печатать.
            </p>
          </div>
        )}
      </div>

      {/*
        Превью в виде настоящей шапки, а не картинки на белом: логотип живёт на
        тёмной полосе рядом с названием и часами, и оценить его можно только там.
      */}
      <aside className="ls-preview">
        <span className="ls-field-label">Шапка приложения</span>
        <HeaderStripPreview view={headerBrandView(branding)} />
        <p className="ls-note">
          {branding.uiLogo
            ? 'Знак вписывается по высоте целиком. Как он стоит рядом с надписью — в блоке «Шапка приложения» ниже.'
            : 'Логотип в шапке выключен: там останутся надпись и часы.'}
        </p>
      </aside>

      {cropOpen && sourceImage && (
        <ImageCropper
          source={sourceImage}
          title="Обрезка логотипа для интерфейса"
          initialShape={branding.logoShape === 'circle' ? 'circle' : 'square'}
          // Форму несёт сам файл: круглая обрезка запекается в PNG вместе с
          // прозрачностью, и подкладывать под превью круглую рамку не нужно.
          renderPreview={(result) => <HeaderStripPreview view={viewWithMark(result)} />}
          onApply={applyCrop}
          onClose={() => setCropOpen(false)}
          onError={onError}
        />
      )}
    </div>
  )
}
