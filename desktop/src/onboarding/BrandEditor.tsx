/**
 * Оформление: заводской бренд, подпись к логотипу и цвета.
 *
 * Главное решение шага — первое: большинству мелких точек логотип не нужен, и
 * заставлять их что-то загружать, чтобы нажать «Далее», незачем. Поэтому
 * заводской бренд стоит отдельной карточкой и выбран по умолчанию, а весь
 * редактор появляется только у тех, кто выбрал свой.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_PRIMARY,
  accentOtherThemeWarning,
  accentProblem,
  isValidHex,
  normalizeHex,
  readableTextOn,
  sanitizeHexInput,
} from '../auth/applyTheme'
import type { ThemeMode } from '../auth/applyTheme'
import { reportError } from '../services/reportError'
import { loadSettings, saveSettings } from '../settings/appSettings'
import {
  RECEIPT_LOGO_WIDTHS,
  THERMAL_STYLES,
  buildLogoVariants,
  buildReceiptLogoVariants,
  imageFileProblem,
  renderThermalPreview,
  shrinkOversizedImage,
  thermalStyleById,
  tightenImage,
} from './logoCanvas'
import type { ThermalStyle } from './logoCanvas'
import { FilePickerZone } from './FilePickerZone'
import { ImageCropper } from './ImageCropper'
import type { CropResult } from './ImageCropper'
import { FACTORY_BRAND, resolveBrand } from '../brand/brand'
import { HeaderStripPreview, headerBrandView } from '../layout/HeaderBrand'
import {
  HEADER_LAYOUTS,
  LOGO_TEXT_TEMPLATES,
  ROLL_WIDTHS,
  emptyReceiptLogoVariants,
  headerLayoutParts,
  receiptCropSource,
  usesOwnReceiptLogo,
} from './types'
import type {
  BrandingData,
  LogoTextSize,
  ReceiptHeaderMode,
  RollWidth,
} from './types'
import './BrandEditor.css'

/* -------------------------------------------------------------------------- */
/* E.1 — заводской бренд или свой                                             */
/* -------------------------------------------------------------------------- */

export function BrandModePicker({
  value,
  onChange,
}: {
  value: boolean
  onChange: (useFactoryBrand: boolean) => void
}) {
  return (
    <div className="be-cards" role="radiogroup" aria-label="Бренд">
      <button
        type="button"
        role="radio"
        aria-checked={value}
        className={`be-card${value ? ' is-selected' : ''}`}
        onClick={() => onChange(true)}
      >
        <span className="be-card__head">
          <strong>Оставить {FACTORY_BRAND.name}</strong>
          <span className="be-card__radio" aria-hidden="true">
            <i />
          </span>
        </span>
        <p>
          Логотип, название и мятный цвет системы. Заполнять ничего не нужно — можно идти дальше.
        </p>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={!value}
        className={`be-card${!value ? ' is-selected' : ''}`}
        onClick={() => onChange(false)}
      >
        <span className="be-card__head">
          <strong>Свой бренд</strong>
          <span className="be-card__radio" aria-hidden="true">
            <i />
          </span>
        </span>
        {/* Перечислено именно то, что внутри: клиент должен понимать, что
            выбирает не «загрузку картинки», а весь внешний вид системы. */}
        <p>Свой логотип, название в шапке, основной цвет и логотип для чека.</p>
      </button>

      {/* Переключение обратимо, и сказать об этом надо: иначе «Свой бренд»
          выглядит дверью в один конец, и его боятся нажимать. */}
      <p className="be-cards__note">
        Переключаться можно в любой момент: вернувшись к {FACTORY_BRAND.name}, вы не потеряете ни
        загруженный логотип, ни название, ни выбранный цвет.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* E.3 — компоновка шапки приложения: знак и надпись                          */
/* -------------------------------------------------------------------------- */

const SIZES: { id: LogoTextSize; label: string }[] = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
]

type HeaderEditorProps = {
  branding: BrandingData
  onChange: (patch: Partial<BrandingData>) => void
  onError: (message: string) => void
}

/** Какой слот шапки сейчас загружают или обрезают. */
type HeaderSlot = 'wordmark' | 'combined'

const SLOT_TITLES: Record<HeaderSlot, string> = {
  wordmark: 'Обрезка надписи',
  combined: 'Обрезка картинки для шапки',
}

/**
 * Как устроена шапка приложения: компоновка, надпись и единая картинка.
 *
 * Главное решение блока — компоновка. Название магазина здесь тоже картинка, а
 * не текст: рядом со знаком, нарисованным дизайнером, подобранный настройками
 * шрифт выглядел случайным — в одной полосе сходились две разные типографики.
 * Надпись приходит файлом от того же дизайнера, что рисовал знак.
 *
 * Пока файла надписи нет, название рисуется текстом — тем, что задано полем
 * «Название в интерфейсе». Не реквизитами магазина: как называется торговая
 * точка, к оформлению программы отношения не имеет. Настройки текста (кегль,
 * цвет, начертание) поэтому и остались — но видны только там, где название
 * действительно рисуется текстом.
 *
 * Знак здесь не загружается: он живёт в блоке «Логотип в интерфейсе», и второй
 * зоны загрузки для того же файла быть не должно.
 */
export function AppHeaderEditor({ branding, onChange, onError }: HeaderEditorProps) {
  /* Какой слот обрезаем прямо сейчас. Пусто — редактор закрыт. */
  const [cropping, setCropping] = useState<HeaderSlot | ''>('')
  /*
    Исходники и имена файлов — по слоту, а не одной парой на блок.

    Иначе «Обрезать заново» у одного слота брало бы исходник другого: выбрали
    надпись, сменили компоновку на единую картинку — и переобрезка резала бы
    надпись, подставляя её на место картинки. Исходник вообще держится отдельно
    от результата ровно за этим: переобрезка не должна терять качество на
    повторном кропе уже обрезанного.
  */
  const [sources, setSources] = useState<Partial<Record<HeaderSlot, string>>>({})
  const [fileNames, setFileNames] = useState<Partial<Record<HeaderSlot, string>>>({})
  const [picking, setPicking] = useState(false)
  /* Отказ показываем в самом блоке: человек смотрит туда, куда нажал. */
  const [problem, setProblem] = useState('')

  const parts = headerLayoutParts(branding.headerLayout)
  const textColor = branding.logoTextColor || (branding.theme === 'dark' ? '#ffffff' : '#10151d')
  // Название берётся из бренда, а не из реквизитов магазина: `suggestedName`
  // остался только для монограммы, где нужны инициалы торговой точки.
  const view = useMemo(() => headerBrandView(branding), [branding])
  const displayName = resolveBrand(branding).name

  /* Название рисуется текстом только там, где надписи-картинки нет. */
  const nameAsText = parts.wordmark && !branding.logoWordmark

  const slotImage = (slot: HeaderSlot) =>
    slot === 'wordmark' ? branding.logoWordmark : branding.logoCombined

  const putSlot = (slot: HeaderSlot, image: string) =>
    onChange(slot === 'wordmark' ? { logoWordmark: image } : { logoCombined: image })

  /**
   * Выбор файла под слот шапки.
   *
   * Проверки идут до обработки: пустой, чужой или неподъёмный файл дальше по
   * цепочке даёт исключение уже внутри canvas, где объяснить его человеку
   * нечем. Список проверок общий на все места загрузки — см. logoCanvas.
   */
  const pickFile = async (slot: HeaderSlot, file: File) => {
    const fileProblem = imageFileProblem(file)
    if (fileProblem) {
      setProblem(fileProblem)
      return
    }
    setProblem('')
    setPicking(true)
    try {
      // Тот же порог, что и у остальных загрузок: снимок с телефона легко
      // весит 8 МБ, и отказ читается как «программа не работает».
      const image = await shrinkOversizedImage(file, file.size > 5 * 1024 * 1024 ? 1600 : 2048)
      setFileNames((prev) => ({ ...prev, [slot]: file.name }))
      setSources((prev) => ({ ...prev, [slot]: image }))
      setCropping(slot)
    } catch (caught) {
      // В журнал — с именем и размером файла: без них воспроизвести падение по
      // одному сообщению «не удалось открыть» невозможно.
      reportError('AppHeaderEditor.pickFile', caught, { name: file.name, size: file.size })
      setProblem(caught instanceof Error ? caught.message : 'Не удалось открыть изображение.')
    } finally {
      setPicking(false)
    }
  }

  /**
   * Применение обрезки.
   *
   * Прозрачные поля срезаются: холст обрезки всегда квадратный, и широкая
   * надпись заняла бы в нём четверть высоты — в шапке она вышла бы вчетверо
   * мельче знака рядом.
   */
  const applyCrop = async ({ image }: CropResult) => {
    if (!cropping) return
    putSlot(cropping, await tightenImage(image))
  }

  /** Зона загрузки со всем, что к ней прилагается: обрезка, замена, снятие. */
  const slotPicker = (slot: HeaderSlot, label: string, hint: string) => {
    const image = slotImage(slot)
    return (
      <div className="be-field">
        <span className="ob-label">{label}</span>
        <FilePickerZone
          label={image ? 'Заменить файл' : 'Выбрать файл'}
          hint={hint}
          fileName={fileNames[slot]}
          busy={picking}
          onPick={(file) => void pickFile(slot, file)}
          onError={setProblem}
        />
        {image && (
          <div className="be-actions">
            <button
              type="button"
              className="ls-btn ls-btn--ghost"
              disabled={picking}
              onClick={() => setCropping(slot)}
            >
              Обрезать заново
            </button>
            <button
              type="button"
              className="ls-btn ls-btn--ghost"
              disabled={picking}
              onClick={() => {
                putSlot(slot, '')
                setFileNames((prev) => ({ ...prev, [slot]: '' }))
                setSources((prev) => ({ ...prev, [slot]: '' }))
              }}
            >
              Убрать картинку
            </button>
          </div>
        )}
        <small className="ob-hint">
          В обрезке есть «Убрать белый фон» — им лечится файл, нарисованный на белом листе: на
          тёмной полосе шапки такой лист виден белым прямоугольником вокруг букв. Прозрачность
          настоящая, белой каймы по контуру не остаётся.
        </small>
      </div>
    )
  }

  return (
    <div className="be-text">
      <div className="be-field">
        <span className="ob-label">Компоновка шапки</span>
        <div className="be-chips">
          {HEADER_LAYOUTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`be-chip${branding.headerLayout === item.id ? ' is-active' : ''}`}
              title={item.hint}
              onClick={() => onChange({ headerLayout: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <small className="ob-hint">
          {HEADER_LAYOUTS.find((item) => item.id === branding.headerLayout)?.hint}. Настройка
          экрана: шапка чека настраивается отдельно ниже — это разные носители и разные картинки.
        </small>
      </div>

      {/*
        Живой предпросмотр стоит сразу под выбором, а не в конце блока: смысл
        компоновки виден только по картинке, а не по названию варианта.
      */}
      <div className="be-preview-block">
        <span className="ob-label">Как это будет выглядеть</span>
        <HeaderStripPreview view={view} />
      </div>

      {problem && (
        <p className="be-error" role="alert">
          {problem}
        </p>
      )}

      {/*
        Объёмный вид. Переключатель стоит рядом с парой «до/после», а не в
        отдельном углу настроек: эффект мягкий по замыслу, и словами «фаска по
        контуру» его не оценить — нужно видеть обе полосы разом.
      */}
      <div className="be-field">
        <label className="be-check">
          <input
            type="checkbox"
            checked={branding.logoEmboss}
            onChange={(event) => onChange({ logoEmboss: event.target.checked })}
          />
          <span>
            <strong>Объёмный вид логотипа</strong>
            <small>
              Светлая кромка сверху, тёмная снизу и мягкая тень под знаком. Рисуется по контуру
              картинки, поэтому работает и на круглом знаке, и на произвольном, и на буквах
              надписи. Сам файл не меняется — эффект снимается в любой момент
            </small>
          </span>
        </label>

        <div className="be-emboss">
          <figure>
            <HeaderStripPreview view={{ ...view, emboss: false }} />
            <figcaption>Без объёма</figcaption>
          </figure>
          <figure>
            <HeaderStripPreview view={{ ...view, emboss: true }} />
            <figcaption>С объёмом</figcaption>
          </figure>
        </div>
      </div>

      {parts.combined &&
        slotPicker(
          'combined',
          'Картинка для шапки',
          'Один файл, где знак и надпись уже вместе. PNG, JPG, WebP или SVG',
        )}

      {parts.wordmark &&
        slotPicker(
          'wordmark',
          'Надпись с названием',
          'Только надпись, без знака. Прозрачный PNG ложится на тёмную полосу лучше всего',
        )}

      {parts.mark && (
        <p className="be-note">
          Знак берётся из блока «Логотип в интерфейсе» выше — отдельно его здесь не загружают,
          чтобы одна и та же картинка не оказалась заведена дважды.
        </p>
      )}

      {/*
        Оформление названия текстом. Показывается только тогда, когда название
        действительно рисуется текстом: как только загружена надпись, эти
        настройки ни на что не влияют, и держать их на экране — обманывать.
      */}
      {nameAsText && (
        <>
          <p className="be-note">
            Картинки надписи пока нет — в шапке рисуется текстом название из поля «Название в
            интерфейсе» («{displayName}»). Загрузите файл выше, чтобы вместо текста стояла фирменная
            надпись.
          </p>

          <div className="be-row">
            <div className="be-field">
              <span className="ob-label">Размер названия</span>
              <div className="be-chips">
                {SIZES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`be-chip${branding.logoTextSize === item.id ? ' is-active' : ''}`}
                    onClick={() => onChange({ logoTextSize: item.id })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="be-field">
              <span className="ob-label">Цвет названия</span>
              <div className="be-chips">
                <button
                  type="button"
                  className={`be-chip${branding.logoTextColor ? '' : ' is-active'}`}
                  onClick={() => onChange({ logoTextColor: '' })}
                >
                  Авто из темы
                </button>
                <input
                  type="color"
                  className="be-color-input"
                  value={textColor}
                  onChange={(event) => onChange({ logoTextColor: event.target.value })}
                  aria-label="Свой цвет названия"
                />
              </div>
            </div>
          </div>

          <div className="be-field">
            <span className="ob-label">Начертание</span>
            <div className="be-templates">
              {LOGO_TEXT_TEMPLATES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`be-template${branding.logoTextTemplate === item.id ? ' is-active' : ''}`}
                  style={{ fontFamily: item.family, fontWeight: item.weight }}
                  onClick={() => onChange({ logoTextTemplate: item.id })}
                >
                  <b>{displayName}</b>
                  <small>{item.label}</small>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <p className="be-note">
        Высота шапки от компоновки не зависит: картинки вписываются в неё по высоте, а ширину
        занимают свою. В чеке название печатает сам принтер своим шрифтом — там эта настройка ни
        на что не влияет.
      </p>

      {/* Исходник — свежий файл, если он ещё в руках, иначе то, что уже лежит:
          после перезапуска другого источника попросту нет. */}
      {cropping && (sources[cropping] || slotImage(cropping)) && (
        <ImageCropper
          source={sources[cropping] || slotImage(cropping)}
          title={SLOT_TITLES[cropping]}
          /*
            Свободная форма для обеих картинок.

            Пропорции здесь задаёт сам файл: у надписи они какие угодно — от
            короткого слова почти в квадрат до длинного названия десять к
            одному. Навязанная рамка 4:1 срезала бы первому буквы, а второму
            добавила бы пустых полей, которые потом снова пришлось бы убирать.
            В шапку картинка всё равно вписывается по высоте.
          */
          initialShape="free"
          renderPreview={(result) => (
            <HeaderStripPreview
              view={
                cropping === 'wordmark'
                  ? { ...view, wordmark: result, name: '' }
                  : { ...view, combined: result }
              }
            />
          )}
          onApply={applyCrop}
          onClose={() => setCropping('')}
          onError={onError}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* E.4 — логотип в чеке: отдельный блок со своей обрезкой                     */
/* -------------------------------------------------------------------------- */

/**
 * Как знак ляжет на ленту — маленькое ч/б превью.
 *
 * Отдельным компонентом, потому что нужно в двух местах: в самом блоке чека и
 * внутри редактора обрезки, где показывает результат ещё до применения.
 * Пересчёт с паузой: перевод в один бит — это проход по каждому пикселю.
 */
function ThermalPreview({
  source,
  width,
  style,
  threshold,
}: {
  source: string
  width: number
  style: ThermalStyle
  threshold: number
}) {
  const [image, setImage] = useState('')

  useEffect(() => {
    if (!source) {
      setImage('')
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void renderThermalPreview(source, { width, style, threshold })
        .then((result) => {
          if (!cancelled) setImage(result)
        })
        .catch(() => {
          if (!cancelled) setImage('')
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [source, width, style, threshold])

  if (!image) return null
  return (
    <figure className="be-thermal be-thermal--compact">
      <img src={image} alt="Как логотип напечатается на ленте" />
      <figcaption>Так знак ляжет на ленту: один цвет, {width} точек в ширину</figcaption>
    </figure>
  )
}

const HEADER_MODES: { id: ReceiptHeaderMode; label: string }[] = [
  { id: 'logo', label: 'Только логотип' },
  { id: 'logo_name', label: 'Логотип и название' },
  { id: 'name', label: 'Только название' },
]

/**
 * Логотип в чеке.
 *
 * Настраивается независимо от интерфейсного, и это главное в блоке: магазин
 * может печатать знак на чеках, не показывая его в шапке, и наоборот. Файл по
 * умолчанию берётся тот же, но обрезать его под ленту можно заново — пропорции
 * у чека другие, и квадратный знак из шапки на 384 точках часто не годится.
 *
 * Ч/б превью показывается всегда, даже когда печать выключена: термопринтер
 * знает только чёрное и белое, и светло-серый логотип выйдет пустым пятном.
 * Увидеть это надо до первого чека, а не после сотни.
 */
export function ReceiptLogoEditor({
  branding,
  onChange,
  onError,
}: {
  branding: BrandingData
  onChange: (patch: Partial<BrandingData>) => void
  onError: (message: string) => void
}) {
  const [cropOpen, setCropOpen] = useState(false)
  const [preview, setPreview] = useState('')
  const [picking, setPicking] = useState(false)
  const [receiptFileName, setReceiptFileName] = useState('')
  /* Отказ показываем в самом блоке, а не только строкой в подвале мастера:
     человек смотрит туда, куда нажал, и подвал в этот момент вне поля зрения. */
  const [problem, setProblem] = useState('')
  /* Режим «свой файл» включается галочкой и до выбора файла: иначе снять
     галочку было бы некуда — зона загрузки не появилась бы. */
  const [ownMode, setOwnMode] = useState(() => usesOwnReceiptLogo(branding))
  const ownFile = usesOwnReceiptLogo(branding)
  const cropSource = receiptCropSource(branding)

  /**
   * Загрузка отдельной картинки для чека.
   *
   * Трогает только чековые поля — интерфейсный логотип остаётся нетронутым,
   * ради этого блок и разделён. Обрезка открывается сразу после выбора: у
   * ленты своя пропорция, и файл почти никогда не подходит как есть.
   */
  const pickReceiptFile = async (file: File) => {
    // Проверки до обработки: пустой, чужой или неподъёмный файл дальше по
    // цепочке даёт исключение уже внутри canvas, где объяснить его человеку
    // нечем. Список проверок общий на все три места загрузки — см. logoCanvas.
    const fileProblem = imageFileProblem(file)
    if (fileProblem) {
      setProblem(fileProblem)
      return
    }
    setProblem('')
    setPicking(true)
    try {
      // Тот же порог, что и у интерфейсного логотипа: снимок с телефона легко
      // весит 8 МБ, и отказ читается как «программа не работает».
      const source = await shrinkOversizedImage(file, file.size > 5 * 1024 * 1024 ? 1600 : 2048)
      setReceiptFileName(file.name)
      onChange({
        receiptLogoFile: source,
        // Прежняя обрезка относилась к прежнему файлу — она больше не годится.
        receiptLogoMark: '',
        receiptLogoVariants: emptyReceiptLogoVariants(),
      })
      setCropOpen(true)
    } catch (caught) {
      // В журнал — с именем и размером файла: без них воспроизвести падение
      // по одному сообщению «не удалось открыть» невозможно.
      reportError('BrandEditor.pickReceiptFile', caught, { name: file.name, size: file.size })
      setProblem(caught instanceof Error ? caught.message : 'Не удалось открыть изображение.')
    } finally {
      setPicking(false)
    }
  }

  /*
    Живое ч/б превью.

    Считается из того же знака, той же ширины и того же шаблона, что уйдут в
    печать: показать одно, а напечатать другое — хуже, чем не показывать
    вовсе. Пересчёт идёт на каждое движение ползунка, поэтому с паузой —
    гонять canvas по 384 точки на каждый кадр незачем.
  */
  useEffect(() => {
    const mark = branding.receiptLogoMark || cropSource
    if (!mark) {
      setPreview('')
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void renderThermalPreview(mark, {
        width: RECEIPT_LOGO_WIDTHS[branding.receiptRollWidth],
        style: branding.receiptLogoStyle,
        threshold: branding.receiptLogoThreshold,
      })
        .then((result) => {
          if (!cancelled) setPreview(result)
        })
        .catch(() => {
          if (!cancelled) setPreview('')
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    cropSource,
    branding.receiptLogoMark,
    branding.receiptRollWidth,
    branding.receiptLogoStyle,
    branding.receiptLogoThreshold,
  ])

  /**
   * Обрезка под чек трогает только чековые поля — интерфейсный знак цел.
   *
   * Круглая обрезка сюда приходит уже с прозрачностью за границей круга, а
   * перевод в один бит заливает прозрачное белым (см. renderThermalPreview):
   * иначе вокруг круглого знака на ленте печатался бы чёрный квадрат.
   */
  const applyReceiptCrop = async ({ image, shape }: CropResult) => {
    const variants = await buildReceiptLogoVariants(image, {
      style: branding.receiptLogoStyle,
      threshold: branding.receiptLogoThreshold,
    })
    onChange({ receiptLogoMark: image, receiptLogoVariants: variants, receiptLogoShape: shape })
  }

  /**
   * Смена шаблона или порога пересобирает то, что реально уйдёт на печать.
   *
   * Без пересборки настройка осталась бы косметикой: превью показывало бы
   * одно, а принтер печатал бы вариант, собранный при обрезке.
   */
  const applyThermal = async (patch: { style?: ThermalStyle; threshold?: number }) => {
    const style = patch.style ?? branding.receiptLogoStyle
    // Смена шаблона подставляет свой порог: у контрастного и у контура они
    // разные, и оставлять чужой — значит показать человеку заведомо плохой
    // результат от шаблона, который ему как раз подходит.
    const threshold =
      patch.threshold ?? (patch.style ? thermalStyleById(patch.style).threshold : branding.receiptLogoThreshold)

    const mark = branding.receiptLogoMark || cropSource
    if (!mark) {
      onChange({ receiptLogoStyle: style, receiptLogoThreshold: threshold })
      return
    }
    const variants = await buildReceiptLogoVariants(mark, { style, threshold })
    onChange({ receiptLogoStyle: style, receiptLogoThreshold: threshold, receiptLogoVariants: variants })
  }

  const printsLogo = branding.receiptLogo && branding.receiptHeader !== 'name'

  /**
   * Ширина рулона живёт в двух местах по необходимости: в реквизитах — как
   * решение владельца, в локальных настройках принтера — как параметр печати
   * ESC/POS. Переключатель здесь один, и он сразу приводит обе записи к одному
   * значению: иначе чек печатался бы одной ширины, а логотип готовился под
   * другую, и разошлись бы они молча.
   */
  const setRollWidth = (width: RollWidth) => {
    onChange({ receiptRollWidth: width })
    const settings = loadSettings()
    if (settings.printer.paperWidth !== width) {
      saveSettings({ ...settings, printer: { ...settings.printer, paperWidth: width } })
    }
  }

  return (
    <div className="be-receipt">
      <label className="be-check">
        <input
          type="checkbox"
          checked={branding.receiptLogo}
          onChange={(event) => onChange({ receiptLogo: event.target.checked })}
        />
        <span>
          <strong>Печатать логотип в чеке</strong>
          <small>Можно включить или выключить в любой момент. Шапки приложения не касается</small>
        </span>
      </label>

      <div className="be-row">
        {/* Под заводским брендом выбирать нечего: знак и название наши, и
            остаётся единственное решение магазина — печатать их или нет. */}
        {!branding.useFactoryBrand && (
          <div className="be-field">
            <span className="ob-label">Что печатать в шапке чека</span>
            <div className="be-chips">
              {HEADER_MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`be-chip${branding.receiptHeader === item.id ? ' is-active' : ''}`}
                  disabled={!branding.receiptLogo && item.id !== 'name'}
                  onClick={() => onChange({ receiptHeader: item.id })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ширина рулона — свойство принтера, а не бренда: нужна в обоих
            режимах, от неё зависит и размер знака, и ширина превью чека. */}
        <div className="be-field">
          <span className="ob-label">Ширина рулона</span>
          <div className="be-chips">
            {ROLL_WIDTHS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`be-chip${branding.receiptRollWidth === item.id ? ' is-active' : ''}`}
                onClick={() => setRollWidth(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {
        <div className="be-receipt__crop">
          {/*
            Источник картинки для чека.

            Показывается в обоих режимах бренда, и это важно. Раньше блок был
            скрыт под «своим брендом», а он не выбран по умолчанию — кнопки
            загрузки было попросту негде увидеть. При этом сочетание «в шапке
            наш знак, на чеке свой» совершенно нормальное: экран и лента живут
            по разным правилам.

            По умолчанию берётся файл из интерфейса — большинству этого хватает.
            Но на ленте в один бит цветной знак с тонкими линиями рассыпается, и
            магазину нужна не переобрезка того же файла, а другая картинка:
            упрощённая, чёрно-белая. Поэтому здесь именно загрузка.
          */}
          <label className="be-check">
            <input
              type="checkbox"
              checked={!ownMode}
              onChange={(event) => {
                if (event.target.checked) {
                  // Возврат к интерфейсному файлу стирает и свою картинку, и
                  // построенную из неё обрезку: оставить обрезку от другого
                  // файла значит печатать неизвестно что.
                  setOwnMode(false)
                  onChange({
                    receiptLogoFile: '',
                    receiptLogoMark: '',
                    receiptLogoVariants: emptyReceiptLogoVariants(),
                  })
                } else {
                  setOwnMode(true)
                }
              }}
            />
            <span>
              <strong>Использовать логотип из интерфейса</strong>
              <small>
                {branding.useFactoryBrand
                  ? 'Под заводским брендом своей картинки нет — снимите галочку, чтобы загрузить логотип отдельно для чека. В шапке приложения он не появится'
                  : 'Снимите галочку, чтобы загрузить для чека отдельную картинку — обычно упрощённую чёрно-белую'}
              </small>
            </span>
          </label>

          {ownMode ? (
            <>
              <FilePickerZone
                label={ownFile ? 'Заменить файл для чека' : 'Выбрать файл для чека'}
                hint="PNG, JPG, WebP или SVG. После выбора откроется обрезка под ленту"
                fileName={receiptFileName}
                busy={picking}
                onPick={(file) => void pickReceiptFile(file)}
                onError={setProblem}
              />
              {problem && (
                <p className="be-error" role="alert">
                  {problem}
                </p>
              )}
              {ownFile && (
                <>
                  <div className="be-actions">
                    <button
                      type="button"
                      className="ls-btn ls-btn--ghost"
                      onClick={() => setCropOpen(true)}
                      disabled={picking}
                    >
                      {branding.receiptLogoMark ? 'Переобрезать под чек' : 'Обрезать под чек'}
                    </button>
                  </div>
                  <p className="be-note">
                    У чека свой файл. Логотип в интерфейсе он не меняет — это две независимые
                    картинки.
                  </p>
                </>
              )}
            </>
          ) : cropSource ? (
            <>
              <div className="be-actions">
                <button
                  type="button"
                  className="ls-btn ls-btn--ghost"
                  onClick={() => setCropOpen(true)}
                >
                  {branding.receiptLogoMark ? 'Переобрезать под чек' : 'Обрезать под чек'}
                </button>
                {branding.receiptLogoMark && (
                  <button
                    type="button"
                    className="ls-btn ls-btn--ghost"
                    onClick={() =>
                      onChange({ receiptLogoMark: '', receiptLogoVariants: emptyReceiptLogoVariants() })
                    }
                  >
                    Вернуть общую обрезку
                  </button>
                )}
              </div>
              <p className="be-note">
                {branding.receiptLogoMark
                  ? 'У чека своя обрезка того же файла. Логотип в интерфейсе она не меняет.'
                  : 'Используется тот же файл, что и в интерфейсе. Обрежьте его под ленту, если знак не помещается.'}
              </p>
            </>
          ) : (
            <p className="be-note">
              Логотипа ещё нет. Загрузите файл в блоке «Логотип в интерфейсе» — или снимите галочку
              выше и выберите отдельную картинку для чека.
            </p>
          )}
        </div>
      }

      {/*
        Обработка под термопечать. Шаблон, порог и превью стоят рядом
        намеренно: смысл настройки виден только по результату, а не по
        названию — «контрастный» ничего не говорит, пока не видно, что он
        делает с этим конкретным логотипом.
      */}
      {(branding.receiptLogoMark || cropSource) && (
        <div className="be-thermal-tune">
          <div className="be-field">
            <span className="ob-label">Обработка для термопринтера</span>
            <div className="be-chips">
              {THERMAL_STYLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`be-chip${branding.receiptLogoStyle === item.id ? ' is-active' : ''}`}
                  title={item.hint}
                  onClick={() => void applyThermal({ style: item.id })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <small className="ob-hint">{thermalStyleById(branding.receiptLogoStyle).hint}</small>
          </div>

          <label className="be-field be-threshold">
            <span className="ob-label">Порог чёрного — {branding.receiptLogoThreshold}</span>
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={branding.receiptLogoThreshold}
              onChange={(event) => void applyThermal({ threshold: Number(event.target.value) })}
            />
            <small className="ob-hint">
              Левее — на ленту попадёт больше тёмного, правее — меньше. Смотрите на превью справа.
            </small>
          </label>
        </div>
      )}

      {preview && (
        <figure className="be-thermal">
          <img src={preview} alt="Как логотип напечатается на ленте" />
          <figcaption>
            Так знак ляжет на ленту {branding.receiptRollWidth} мм —{' '}
            {RECEIPT_LOGO_WIDTHS[branding.receiptRollWidth]} точек в ширину. Термопринтер печатает в
            один цвет: если здесь картинка почти исчезла — на чеке её тоже не будет.
            {!printsLogo && ' Сейчас печать логотипа выключена, это только предпросмотр.'}
          </figcaption>
        </figure>
      )}

      {cropOpen && cropSource && (
        <ImageCropper
          source={cropSource}
          title="Обрезка логотипа для чека"
          // Лента узкая и длинная: широкая форма подходит чаще квадратной.
          initialShape={branding.receiptLogoShape === 'circle' ? 'circle' : 'wide'}
          // Предпросмотр сразу на ленте: логотип, красивый на экране, на 384
          // точках в один бит выглядит совсем иначе, и увидеть это надо до
          // применения, а не после первой сотни чеков.
          renderPreview={(result) => (
            <ThermalPreview
              source={result}
              width={RECEIPT_LOGO_WIDTHS[branding.receiptRollWidth]}
              style={branding.receiptLogoStyle}
              threshold={branding.receiptLogoThreshold}
            />
          )}
          onApply={applyReceiptCrop}
          onClose={() => setCropOpen(false)}
          onError={onError}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* E.5 — цвета                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Готовые варианты.
 *
 * Каждый проверен на обеих темах: залитая им кнопка видна и на белой
 * поверхности, и на тёмной (см. accentProblem). Поэтому здесь нет ни графита,
 * ни почти-белого — на своей теме они пропадают, и предлагать их значит
 * предлагать сломать себе интерфейс в одно нажатие. Свой цвет при этом никуда
 * не делся: поле рядом, и там такие цвета честно отклоняются с объяснением.
 */
const ACCENT_PRESETS = [
  { hex: '#00f5bc', name: 'Мятный' },
  { hex: '#4f46e5', name: 'Индиго' },
  { hex: '#2563eb', name: 'Синий' },
  { hex: '#0f9d58', name: 'Зелёный' },
  { hex: '#e2761b', name: 'Янтарный' },
  { hex: '#d0342c', name: 'Красный' },
  { hex: '#7c3aed', name: 'Фиолетовый' },
  { hex: '#475569', name: 'Сланец' },
]

export function AccentPicker({
  value,
  mode,
  branding,
  onChange,
}: {
  value: string
  /** Тема нужна для проверки: один и тот же цвет годен на светлой и пропадает на тёмной. */
  mode: ThemeMode
  /** Оформление целиком — ради превью шапки: знак и название в нём настоящие. */
  branding: BrandingData
  onChange: (hex: string) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  const commit = (raw: string) => {
    const clean = sanitizeHexInput(raw)
    setDraft(clean)
    if (isValidHex(clean)) onChange(clean)
  }

  // Цвет текста на кнопках считается из контраста, а не выбирается вручную:
  // белые надписи на светлом акценте — тот самый баг, который так и появлялся.
  const buttonText = readableTextOn(value)
  const problem = accentProblem(value, mode)
  const warning = problem ? '' : accentOtherThemeWarning(value, mode)
  const isDefault = normalizeHex(value) === DEFAULT_PRIMARY

  return (
    <div className="be-colors">
      <div className="be-swatches">
        {ACCENT_PRESETS.map((preset) => (
          <button
            key={preset.hex}
            type="button"
            title={preset.name}
            aria-label={preset.name}
            className={`be-swatch${value.toLowerCase() === preset.hex ? ' is-active' : ''}`}
            style={{ background: preset.hex }}
            onClick={() => onChange(preset.hex)}
          />
        ))}
      </div>

      <div className="be-custom">
        <label className="be-field">
          <span className="ob-label">Свой цвет</span>
          <div className="be-custom__row">
            <input
              type="color"
              className="be-color-input"
              value={isValidHex(draft) ? draft : value}
              onChange={(event) => commit(event.target.value)}
              aria-label="Выбрать цвет"
            />
            <input
              className={`ob-control be-hex${problem ? ' is-invalid' : ''}`}
              value={draft}
              maxLength={7}
              spellCheck={false}
              onChange={(event) => commit(event.target.value)}
            />
            {/* Возврат к стандартному мятному. Скрывать кнопку, когда цвет и так
                стандартный, нельзя — исчезающий контрол читается как поломка;
                она просто гаснет. */}
            <button
              type="button"
              className="be-reset"
              onClick={() => onChange(DEFAULT_PRIMARY)}
              disabled={isDefault}
              title="Вернуть стандартный цвет системы"
            >
              Стандартный
            </button>
          </div>
        </label>

        {/*
          Превью, а не одна кнопка.

          Кнопка показывает только контраст надписи, а фирменный цвет живёт ещё
          во вкладках, выделении, обводке и подложке карточки — и именно там он
          чаще всего оказывается неудачным. Здесь видно всё сразу, тем же
          набором токенов, что и в настоящем интерфейсе: превью не рисует цвета
          само, оно просто стоит под уже применённым акцентом.
        */}
        <div className="be-preview" aria-label="Как это выглядит в системе">
          <span className="ob-label">Как это выглядит в системе</span>

          {/* Шапка — с настоящим знаком и настоящим названием: цвет виден не
              сам по себе, а рядом с логотипом, с которым ему и жить. Полоса
              тёмная в обеих темах, и как акцент читается на ней, иначе не
              оценить. */}
          <HeaderStripPreview view={headerBrandView(branding)} />

          <div className="be-preview__tabs" role="presentation">
            <span className="be-preview__tab is-active">Товары</span>
            <span className="be-preview__tab">Чеки</span>
            <span className="be-preview__tab">Отчёты</span>
          </div>

          <div className="be-preview__card">
            <div className="be-preview__row">
              <span>К оплате</span>
              <strong className="be-preview__sum">1 240,00</strong>
            </div>
            {/* Возврат остаётся красным при любом акценте — это отдельный
                семантический токен, и в превью он стоит ровно затем, чтобы это
                было видно, а не только написано в задании. */}
            <div className="be-preview__row">
              <span>Возврат</span>
              <strong className="be-preview__refund">−320,00</strong>
            </div>
          </div>

          <button type="button" className="be-demo" style={{ background: value, color: buttonText }}>
            Оплатить
          </button>

          <small className={`ob-hint${problem ? ' is-invalid' : ''}`}>
            {problem ||
              warning ||
              (buttonText === '#000000'
                ? 'Цвет светлый — текст на кнопках стал тёмным автоматически'
                : 'Цвет тёмный — текст на кнопках белый')}
          </small>
        </div>
      </div>
    </div>
  )
}

/**
 * Пересобирает экранные размеры из знака.
 *
 * Источник всегда `logoMark` — исходный знак. Название в картинку не
 * запекается: его рисует интерфейс текстом, поэтому пересборка нужна только
 * после смены самого файла или обрезки.
 *
 * Чековые варианты трогаются только тогда, когда чек ничего своего не имеет —
 * ни отдельного файла, ни своей обрезки. И то и другое задано вручную, и
 * правкой интерфейсного знака их отменять нельзя.
 */
export async function rebuildLogoVariants(branding: BrandingData): Promise<Partial<BrandingData>> {
  const mark = branding.logoMark || branding.logo
  if (!mark) return {}
  const variants = await buildLogoVariants(mark)
  const patch: Partial<BrandingData> = {
    logo: variants.s512,
    logoVariants: variants,
  }
  if (!branding.receiptLogoMark && !branding.receiptLogoFile) {
    patch.receiptLogoVariants = await buildReceiptLogoVariants(mark)
  }
  return patch
}
