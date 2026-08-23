/**
 * Настройка способов безналичной оплаты.
 *
 * Три уровня интеграции стоят рядом, потому что выбирать между ними надо
 * осознанно, а не по названию: статический QR работает в первый же день, но
 * сумму вводит клиент и подтверждает кассир глазами; динамический требует
 * договора с банком, зато сумма вшита в код и подтверждение приходит само.
 *
 * Ничего здесь не обязательно. Мерчант-ключи банк выдаёт днями, и блокировать
 * этим запуск магазина нельзя: недонастроенный провайдер просто не появится на
 * экране оплаты, а касса будет работать на наличных и статическом QR.
 */

import { useEffect, useRef, useState } from 'react'
import { PAYMENT_PRESETS, presetById } from '../payments/presets'
import { fetchProviderSecretFlags, saveProviderSecret } from '../payments/client'
import { providerReadiness } from '../payments/types'
import type { PaymentKind, PaymentProviderConfig } from '../payments/types'
import { FilePickerZone } from './FilePickerZone'
import { ImageCropper } from './ImageCropper'
import { imageFileProblem, shrinkOversizedImage } from './logoCanvas'
import { reportError } from '../services/reportError'
import { autoTrimQr, inspectQr } from './qrImage'
import './PaymentProvidersEditor.css'

/**
 * Выше этого порога снимок ужимается сильнее — до 1600 точек по длинной стороне.
 * Тот же порог, что у логотипа: файл такого размера приходит с камеры, а не
 * из скриншота, и мельчить его не жалко.
 */
const SHRINK_ABOVE_BYTES = 5 * 1024 * 1024

/* Потолок размера файла общий с логотипом — MAX_IMAGE_BYTES в logoCanvas. */

/**
 * Порог дребезга для кнопок добавления, в миллисекундах.
 *
 * Сенсорная панель моноблока иногда отдаёт одно касание двумя нажатиями. Триста
 * миллисекунд короче осознанного повторного нажатия и длиннее дребезга.
 */
const ADD_DEBOUNCE_MS = 300

/**
 * Изменение списка способов оплаты.
 *
 * Функция от предыдущего значения, а не готовый массив, и это не стилистика.
 * Обработчик, который собирает новый массив из пропсов, работает только пока
 * между двумя нажатиями успевает пройти перерисовка. Два быстрых тапа по «+»
 * на сенсорном моноблоке попадают в один кадр, оба читают один и тот же
 * список, и второй затирает первый — способ добавлялся один вместо двух. То же
 * самое ждало «Убрать» и галочки «Включён».
 */
export type ProvidersUpdate = (previous: PaymentProviderConfig[]) => PaymentProviderConfig[]

type Props = {
  value: PaymentProviderConfig[]
  onChange: (update: ProvidersUpdate) => void
  /**
   * Мастер первого запуска: сервера с авторизацией ещё нет, ключ туда не
   * отправить. Поле ключа там показывается с прямым указанием задать его
   * позже, в настройках.
   */
  deferSecrets?: boolean
}

const KIND_OPTIONS: { kind: PaymentKind; title: string; note: string }[] = [
  {
    kind: 'qr-static',
    title: 'Статический QR',
    note: 'Картинка QR вашего банка. Работает сразу, сумму вводит клиент, подтверждает кассир',
  },
  {
    kind: 'qr-dynamic',
    title: 'Динамический QR',
    note: 'Банк отдаёт QR с уже вшитой суммой и сам подтверждает оплату. Нужен договор',
  },
  {
    kind: 'terminal',
    title: 'Платёжный терминал',
    note: 'Банковский POS уже стоит в магазине: касса отдаёт ему сумму, он возвращает результат',
  },
]

/**
 * Счётчик на случай двух добавлений в одну миллисекунду.
 *
 * Идентификатор — это ключ списка в React и адрес карточки в состоянии.
 * Совпади он у двух способов — React считал бы их одним элементом, правка
 * одного меняла бы второй, а «Убрать» удаляло бы оба. Одного `Date.now()` для
 * этого мало: два быстрых нажатия попадают в одну миллисекунду.
 */
let providerSeq = 0

function newProvider(kind: PaymentKind): PaymentProviderConfig {
  providerSeq += 1
  const id = `${kind}-${Date.now().toString(36)}-${providerSeq}`
  if (kind === 'qr-dynamic') {
    return { id, kind, title: 'ELQR (Элкарт)', enabled: true, preset: 'elqr', baseUrl: '' }
  }
  if (kind === 'terminal') {
    return { id, kind, title: 'Терминал', enabled: true, transport: 'com', comPort: 'COM3' }
  }
  return { id, kind, title: 'QR банка', enabled: true }
}

export function PaymentProvidersEditor({ value, onChange, deferSecrets = false }: Props) {
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({})
  const [savingSecret, setSavingSecret] = useState('')
  const [error, setError] = useState('')
  // Имена выбранных файлов — только для подписи под кнопкой. В конфигурацию
  // они не идут: там хранится сама картинка, а имя файла ничего не решает.
  const [imageNames, setImageNames] = useState<Record<string, string>>({})
  /**
   * Чей файл сейчас читается. Многомегабайтный снимок ужимается заметное
   * время, и без этого зона выбора выглядела бы так, будто нажатие не
   * сработало, — человек выбирает файл второй раз.
   */
  const [readingId, setReadingId] = useState('')
  // Какую картинку QR сейчас обрезают. Тот же редактор, что у логотипа —
  // различия задаются пропсами, а не второй копией компонента.
  const [cropping, setCropping] = useState<{ id: string; source: string } | null>(null)
  // Кого только что добавили — к нему прокручиваем после отрисовки.
  const [addedId, setAddedId] = useState('')
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({})
  /** Когда добавляли в прошлый раз — против дребезга сенсорной панели. */
  const lastAddRef = useRef(0)
  /**
   * Развёрнутые карточки. Свёрнутая показывает только название, галочку и
   * миниатюру QR — этого достаточно, чтобы узнать способ в списке.
   *
   * Хранится множество развёрнутых, а не одна: настраивая два банка подряд,
   * человек сравнивает их поля, и схлопывать соседа при раскрытии следующего
   * значит заставлять его щёлкать туда-сюда.
   */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(value.map((p) => p.id)))

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Ключи хранятся на сервере, и интерфейс узнаёт только сам факт их наличия.
  useEffect(() => {
    if (deferSecrets) return
    void fetchProviderSecretFlags()
      .then((flags) => {
        onChange((previous) => {
          const next = previous.map((item) => ({ ...item, secretSet: flags[item.id] ?? false }))
          // Ответ пришёл с задержкой, и за это время способ могли завести или
          // убрать: сверяемся с текущим списком, а не с тем, что был на входе.
          return next.some((item, index) => item.secretSet !== previous[index].secretSet)
            ? next
            : previous
        })
      })
      .catch(() => undefined)
    // Разовая сверка при открытии экрана: держать её в такт с правками формы
    // незачем, флаг меняется только сохранением ключа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferSecrets])

  const patch = (id: string, changes: Partial<PaymentProviderConfig>) => {
    onChange((previous) => previous.map((item) => (item.id === id ? { ...item, ...changes } : item)))
  }

  const remove = (id: string) => onChange((previous) => previous.filter((item) => item.id !== id))

  /**
   * Добавляет способ оплаты и прокручивает к нему.
   *
   * Прокрутка здесь не украшение. Кнопки «+ Статический QR» и соседние стоят
   * под списком, а новая карточка добавляется в его конец — то есть выше
   * кнопки, которую только что нажали, и почти всегда за пределами видимой
   * области. Без прокрутки нажатие выглядит как «ничего не произошло», и
   * человек жмёт ещё раз, заводя второй способ.
   */
  const add = (kind: PaymentKind) => {
    // Защита от дребезга. Сенсорный экран отдаёт один палец двумя нажатиями
    // чаще, чем кажется, а «лишний» способ оплаты человек замечает не сразу —
    // он уезжает вниз списка. Порог заметно меньше времени осознанного второго
    // нажатия, поэтому настоящий двойной ввод не теряется.
    const now = Date.now()
    if (now - lastAddRef.current < ADD_DEBOUNCE_MS) return
    lastAddRef.current = now

    const created = newProvider(kind)
    onChange((previous) => [...previous, created])
    setExpanded((prev) => new Set(prev).add(created.id))
    setAddedId(created.id)
  }

  /* Прокручиваем после отрисовки: до неё карточки в документе ещё нет. */
  useEffect(() => {
    if (!addedId) return
    const node = itemRefs.current[addedId]
    setAddedId('')
    if (!node) return
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // Фокус на названии: следующее действие после добавления — назвать банк.
    node.querySelector<HTMLInputElement>('.pp__title')?.focus()
  }, [addedId, value.length])

  /**
   * Выбор картинки QR.
   *
   * Проверка типа идёт до чтения файла, а вся обработка обёрнута в try/catch:
   * исключение из обработчика события граница ошибок React не ловит — оно
   * всплывает необработанным и снимает всё дерево. Именно так и появлялся
   * белый экран после выбора файла.
   *
   * Большой файл ужимается, а не отвергается. Здесь это не удобство, а
   * работоспособность: снимок экрана с современного телефона весит 2–5 МБ, то
   * есть ровно тот файл, ради которого блок и существует, прежний предел в
   * 2 МБ отсекал целиком. Отказ при этом читался как «программа не работает» —
   * уменьшить снимок владельцу магазина нечем и незачем. Порог сжатия тот же,
   * что у логотипа: см. shrinkOversizedImage.
   */
  const pickImage = async (id: string, file: File) => {
    try {
      // Тот же список проверок, что у логотипа: одно место на все загрузки —
      // см. imageFileProblem в logoCanvas.
      const problem = imageFileProblem(file)
      if (problem) {
        setError(problem)
        return
      }

      setError('')
      setImageNames((prev) => ({ ...prev, [id]: file.name }))
      setReadingId(id)

      // Снимок из банковского приложения почти всегда с полями: шапка,
      // кнопки, подписи. Сразу открываем обрезку — показывать покупателю
      // чужой интерфейс вместо кода незачем.
      const source = await shrinkOversizedImage(file, file.size > SHRINK_ABOVE_BYTES ? 1600 : 2048)
      setCropping({ id, source })
    } catch (error) {
      // В журнал — с именем и размером: по одному «не удалось открыть»
      // падение не воспроизвести.
      reportError('PaymentProvidersEditor.pickImage', error, { name: file.name, size: file.size })
      setError('Не удалось открыть файл. Попробуйте другой снимок.')
    } finally {
      setReadingId('')
    }
  }

  /**
   * Проверка картинки после обрезки.
   *
   * Двух сигналов, а не одного, и это выяснилось на измерении: наш декодер
   * берёт код даже с нулевым полем по краям, а сканер на кассе — нет. Поэтому
   * отдельно проверяется читаемость (обрезали по самому коду) и отдельно
   * ширина тихой зоны (обрезали впритык). Узнать об этом надо здесь, а не на
   * кассе при живом клиенте.
   */
  const checkQrReadable = async (result: string): Promise<string> => {
    const { text, quietZoneModules } = await inspectQr(result)
    if (!text) {
      return 'QR не распознаётся — похоже, обрезано по самому коду. Верните края обратно.'
    }
    if (quietZoneModules >= 0 && quietZoneModules < 2) {
      return 'Код читается, но обрезан впритык. По стандарту вокруг него нужно поле шириной в четыре модуля — без него дешёвые сканеры и старые камеры код не возьмут.'
    }
    return ''
  }

  const storeSecret = async (id: string) => {
    const key = secretDrafts[id]?.trim()
    if (!key) return
    setSavingSecret(id)
    setError('')
    try {
      await saveProviderSecret(id, key)
      patch(id, { secretSet: true })
      setSecretDrafts((prev) => ({ ...prev, [id]: '' }))
    } catch {
      setError('Не удалось сохранить ключ — проверьте, что локальный сервер запущен.')
    } finally {
      setSavingSecret('')
    }
  }

  return (
    <div className="pp">
      {/* Список растёт по содержимому: прокрутка на шаге одна — своя у списка
          прятала половину карточек, см. PaymentProvidersEditor.css. */}
      <ul className="pp__list">
        {value.map((provider) => {
          const readiness = providerReadiness(provider)
          const isOpen = expanded.has(provider.id)
          return (
            <li
              key={provider.id}
              ref={(node) => {
                itemRefs.current[provider.id] = node
              }}
              className={`pp__item${provider.enabled ? '' : ' is-off'}${isOpen ? '' : ' is-collapsed'}`}
            >
              <header className="pp__head">
                <label className="pp__toggle">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) => patch(provider.id, { enabled: event.target.checked })}
                  />
                  <span>Включён</span>
                </label>
                <input
                  className="ob-control pp__title"
                  value={provider.title}
                  maxLength={64}
                  placeholder="Название для кассира"
                  onChange={(event) => patch(provider.id, { title: event.target.value })}
                />
                {/* Миниатюра в шапке: по ней способ узнают в свёрнутом виде,
                    не разворачивая карточку. */}
                {provider.kind === 'qr-static' && provider.imageDataUrl && (
                  <img className="pp__thumb" src={provider.imageDataUrl} alt="" />
                )}
                {/* Свёрнутая карточка — одна строка, поэтому готовность в ней
                    показывает точка, а не абзац текста под шапкой. */}
                {!isOpen && (
                  <span
                    className={`pp__dot${readiness.ready ? ' is-ready' : ''}`}
                    title={readiness.ready ? 'Готов к работе' : readiness.reason}
                    aria-label={readiness.ready ? 'Готов к работе' : readiness.reason}
                  />
                )}
                <button
                  type="button"
                  className="pp__collapse"
                  onClick={() => toggleExpanded(provider.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? 'Свернуть настройки' : 'Развернуть настройки'}
                  title={isOpen ? 'Свернуть' : 'Развернуть'}
                >
                  {isOpen ? '▴' : '▾'}
                </button>
                <button type="button" className="pp__remove" onClick={() => remove(provider.id)}>
                  Убрать
                </button>
              </header>

              {isOpen && (
              <>

              {provider.kind === 'qr-static' && (
                <div className="pp__body">
                  <div className="pp__field">
                    <span className="ob-label">Картинка QR</span>
                    {/* Своя кнопка, а не системный «Файл не выбран»: тот
                        рисуется чужим шрифтом и мелким, а по нему надо попасть
                        пальцем на моноблоке. */}
                    <FilePickerZone
                      label={provider.imageDataUrl ? 'Заменить картинку QR' : 'Выбрать картинку QR'}
                      hint="Снимок экрана QR из приложения банка. Большой файл уменьшим сами"
                      fileName={imageNames[provider.id]}
                      accept="image/*"
                      busy={readingId === provider.id}
                      onPick={(file) => void pickImage(provider.id, file)}
                      onError={setError}
                    />
                  </div>
                  {/*
                    Место под превью занято всегда — и до загрузки тоже.
                    Раньше картинка появлялась из ниоткуда, высота карточки
                    менялась, и список подпрыгивал, теряя из виду то, что
                    человек настраивал.
                  */}
                  <div className="pp__qr-slot">
                    {provider.imageDataUrl ? (
                      <img className="pp__qr" src={provider.imageDataUrl} alt="QR банка" />
                    ) : (
                      <span className="pp__qr-empty">Картинка не выбрана</span>
                    )}
                  </div>
                  {provider.imageDataUrl && (
                    <button
                      type="button"
                      className="ls-btn ls-btn--ghost pp__recrop"
                      onClick={() =>
                        setCropping({ id: provider.id, source: provider.imageDataUrl ?? '' })
                      }
                    >
                      Обрезать заново
                    </button>
                  )}
                </div>
              )}

              {provider.kind === 'qr-dynamic' && (
                <div className="pp__body">
                  <label className="pp__field">
                    <span className="ob-label">Платёжная система</span>
                    <select
                      className="ob-control"
                      value={provider.preset ?? 'custom'}
                      onChange={(event) => {
                        const preset = presetById(event.target.value)
                        patch(provider.id, {
                          preset: preset.id,
                          title: preset.title,
                          baseUrl: preset.baseUrl || provider.baseUrl,
                        })
                      }}
                    >
                      {PAYMENT_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.title}
                        </option>
                      ))}
                    </select>
                    <small className="ob-hint">{presetById(provider.preset).note}</small>
                  </label>

                  <label className="pp__field">
                    <span className="ob-label">Адрес API</span>
                    <input
                      className="ob-control"
                      value={provider.baseUrl ?? ''}
                      placeholder="https://api.bank.kg/qr"
                      spellCheck={false}
                      onChange={(event) => patch(provider.id, { baseUrl: event.target.value })}
                    />
                    <small className="ob-hint">Выдаёт банк вместе с договором</small>
                  </label>

                  <label className="pp__field">
                    <span className="ob-label">Идентификатор мерчанта</span>
                    <input
                      className="ob-control"
                      value={provider.merchantId ?? ''}
                      spellCheck={false}
                      onChange={(event) => patch(provider.id, { merchantId: event.target.value })}
                    />
                  </label>

                  <label className="pp__field">
                    <span className="ob-label">Мерчант-ключ</span>
                    {deferSecrets ? (
                      <p className="pp__later">
                        Ключ задаётся после запуска — в разделе «Реквизиты». Банк выдаёт его днями, и
                        ждать его, чтобы открыть магазин, не нужно.
                      </p>
                    ) : (
                      <div className="pp__secret">
                        <input
                          className="ob-control"
                          type="password"
                          autoComplete="off"
                          value={secretDrafts[provider.id] ?? ''}
                          placeholder={provider.secretSet ? 'Ключ задан — введите новый для замены' : ''}
                          onChange={(event) =>
                            setSecretDrafts((prev) => ({ ...prev, [provider.id]: event.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="pp__save-secret"
                          disabled={savingSecret === provider.id || !secretDrafts[provider.id]?.trim()}
                          onClick={() => void storeSecret(provider.id)}
                        >
                          {savingSecret === provider.id ? 'Сохраняем…' : 'Сохранить ключ'}
                        </button>
                      </div>
                    )}
                    <small className="ob-hint">
                      Ключ хранится только на этом компьютере и в интерфейс больше не возвращается.
                    </small>
                  </label>
                </div>
              )}

              {provider.kind === 'terminal' && (
                <div className="pp__body">
                  <label className="pp__field">
                    <span className="ob-label">Подключение</span>
                    <select
                      className="ob-control"
                      value={provider.transport ?? 'com'}
                      onChange={(event) =>
                        patch(provider.id, { transport: event.target.value as 'com' | 'tcp' })
                      }
                    >
                      <option value="com">COM-порт</option>
                      <option value="tcp">По сети (TCP)</option>
                    </select>
                  </label>

                  {(provider.transport ?? 'com') === 'com' ? (
                    <label className="pp__field">
                      <span className="ob-label">COM-порт</span>
                      <input
                        className="ob-control"
                        value={provider.comPort ?? ''}
                        placeholder="COM3"
                        onChange={(event) => patch(provider.id, { comPort: event.target.value })}
                      />
                    </label>
                  ) : (
                    <label className="pp__field">
                      <span className="ob-label">Адрес терминала</span>
                      <input
                        className="ob-control"
                        value={provider.host ?? ''}
                        placeholder="192.168.1.50"
                        spellCheck={false}
                        onChange={(event) => patch(provider.id, { host: event.target.value })}
                      />
                    </label>
                  )}
                </div>
              )}
              </>
              )}

              {/* Строка готовности видна и в свёрнутом виде: она отвечает на
                  главный вопрос — появится этот способ на кассе или нет. */}
              <p className={`pp__status${readiness.ready ? ' is-ready' : ''}`}>
                {readiness.ready
                  ? 'Готов к работе — появится на экране оплаты'
                  : `${readiness.reason}. Пока не появится на экране оплаты`}
              </p>
            </li>
          )
        })}
      </ul>

      {error && <p className="pp__error">{error}</p>}

      <div className="pp__add">
        {KIND_OPTIONS.map((option) => (
          <button key={option.kind} type="button" className="pp__add-btn" onClick={() => add(option.kind)}>
            <strong>+ {option.title}</strong>
            <small>{option.note}</small>
          </button>
        ))}
      </div>

      <p className="pp__footnote">
        Наличные доступны всегда и настройки не требуют. Оплаты статическим QR помечаются как
        подтверждённые вручную — владелец видит их отдельным отчётом.
      </p>

      {/*
        Обрезка QR тем же редактором, что и логотипы. Различия — в пропсах:
        автообрезка полей и проверка читаемости нужны только здесь.
      */}
      {cropping && (
        <ImageCropper
          source={cropping.source}
          title="Обрезка картинки QR"
          initialShape="square"
          // У кода своя автообрезка — по угловым меткам, а не по однотонным
          // краям: снимок из банка почти всегда с тёмным интерфейсом вокруг,
          // и общий поиск полей вырезал бы вместе с ним.
          autoTrim={autoTrimQr}
          autoTrimEmptyNote="Полей вокруг кода не нашлось — картинка уже обрезана по нему."
          validate={checkQrReadable}
          renderPreview={(result) => (
            <div className="pp__qr-slot">
              <img className="pp__qr" src={result} alt="Картинка QR после обрезки" />
            </div>
          )}
          onApply={({ image }) => {
            patch(cropping.id, { imageDataUrl: image })
          }}
          onClose={() => setCropping(null)}
          onError={setError}
        />
      )}
    </div>
  )
}
