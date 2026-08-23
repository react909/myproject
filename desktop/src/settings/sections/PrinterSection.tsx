import { useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type {
  AppSettings,
  PrinterEncodingMode,
  PrinterProfileId,
} from '../appSettings'
import { useOnboarding } from '../../onboarding/useOnboarding'
import { SettingsHelpFooter } from '../SettingsHelpFooter'
import { applyDeviceSettings, printReceipt } from '../../services/devices/device.client'
import { useNotifications } from '../../components/notifications/NotificationProvider'
import { ReceiptLivePreview, buildPrinterPreviewPayload } from '../../receipt/ReceiptLivePreview'
import {
  MONOBLOCK_PRESETS,
  RECEIPT_LAYOUT_PRESETS,
  applyMonoblockPreset,
  applyReceiptLayoutPreset,
  detectMonoblockPreset,
  detectReceiptLayoutPreset,
  type MonoblockPresetId,
  type ReceiptLayoutPresetId,
} from '../printerPresets'
import './PrinterSection.css'

type ContextType = {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}

const ENCODING_OPTIONS: { value: PrinterEncodingMode; label: string }[] = [
  { value: 'auto', label: 'Auto (рекомендуется)' },
  { value: 'bitmap_raster', label: 'Картинкой / Raster' },
  { value: 'force_russian', label: 'Force Russian' },
  { value: 'cp1251', label: 'CP1251' },
  { value: 'cp866', label: 'CP866' },
  { value: 'chinese_pos', label: 'Chinese POS' },
  { value: 'legacy_escpos', label: 'Legacy ESC/POS' },
  { value: 'utf8_fallback', label: 'UTF-8 Fallback' },
  { value: 'manual', label: 'Manual code page' },
]

export function PrinterSection() {
  const { settings, setSettings } = useOutletContext<ContextType>()
  const { push } = useNotifications()
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  // Реквизиты для превью берутся из общего кэша онбординга, а не из настроек
  // принтера: на ленте печатается ровно то же, что задано в «Реквизитах».
  const onboarding = useOnboarding()
  const previewPayload = useMemo(
    () => buildPrinterPreviewPayload(settings.printer, onboarding),
    [settings.printer, onboarding],
  )

  const patchPrinter = (patch: Partial<AppSettings['printer']>) => {
    setSettings((prev) => ({
      ...prev,
      printer: { ...prev.printer, ...patch },
    }))
  }

  const activePreset = detectMonoblockPreset(settings.printer)
  const activeLayoutPreset = detectReceiptLayoutPreset(settings.printer)
  const isChineseLocked = settings.printer.encodingMode === 'bitmap_raster'

  const applyPreset = (id: MonoblockPresetId) => {
    patchPrinter(applyMonoblockPreset(settings.printer, id))
    push({
      kind: 'success',
      title: 'Принтер',
      message: `Пресет «${MONOBLOCK_PRESETS[id].title}» применён. Нажмите «Тестовая печать».`,
      dismissMs: 5000,
    })
  }

  const applyLayoutPreset = (id: ReceiptLayoutPresetId) => {
    patchPrinter(applyReceiptLayoutPreset(settings.printer, id))
    push({
      kind: 'success',
      title: 'Принтер',
      message: `Вид чека «${RECEIPT_LAYOUT_PRESETS[id].title}» применён. Проверьте preview справа.`,
      dismissMs: 5000,
    })
  }

  const handleTestPreviewPrint = async () => {
    setTesting(true)
    setTestMsg('Печать из preview…')
    try {
      await applyDeviceSettings(settings)
      const r = await printReceipt(previewPayload, settings)
      const msg = r?.message ?? (r?.ok ? 'Тестовый чек отправлен' : 'Нет ответа')
      setTestMsg(msg)
      push({
        kind: r?.ok ? 'success' : 'error',
        title: 'Принтер',
        message: msg,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка печати'
      setTestMsg(msg)
      push({ kind: 'error', title: 'Принтер', message: msg })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="settings-section printer-section">
      <h2 className="settings-section__title">Печать чеков</h2>
      <p className="settings-section__desc">
        Данные магазина, вид чека и принтер. Справа — live preview термоленты 58/80 мм.
      </p>

      <div className="printer-section__layout">
        <div className="printer-section__form settings-form">
          {/* Реквизиты магазина здесь больше не редактируются: они живут в
              разделе «Реквизиты», откуда их берёт и чек, и мастер установки.
              Раньше эти три поля были отдельной копией данных, из-за чего чек
              печатался не тем, что вводили при регистрации. */}
          <fieldset className="printer-section__group">
            <legend className="printer-section__group-title">Данные магазина на чеке</legend>
            <p className="settings-field__hint">
              Наименование, адрес, ИНН и реквизиты ККМ печатаются из раздела{' '}
              <Link to="/settings/requisites">Реквизиты</Link>. Превью справа обновляется сразу после их изменения.
            </p>
          </fieldset>

          <fieldset className="printer-section__group">
            <legend className="printer-section__group-title">Вид чека (58 мм моноблок)</legend>

            {/*
              Селектора ширины ленты здесь намеренно нет.

              Он один на всё приложение и стоит в реквизитах, в блоке «Логотип
              в чеке»: от ширины зависит не только раскладка печати, но и размер
              чекового логотипа (384 точки на 80 мм, 288 на 58). Два независимых
              переключателя одного и того же рулона рано или поздно разошлись бы,
              и чек печатался бы одной ширины, а логотип готовился под другую.
            */}
            {/* Ссылки на сервисный мастер здесь нет намеренно: подсказать
                кассиру дорогу к настройкам установки — то же самое, что
                оставить пункт меню. Кто вправе менять ширину, тот знает, где
                она лежит. */}
            <p className="settings-field__hint">
              Ширина ленты — {settings.printer.paperWidth} мм. Задаётся при установке вместе с
              чековым логотипом: от неё зависит и размер знака на ленте (384 точки на 80 мм, 288
              на 58). Чтобы сменить рулон, вызовите специалиста.
            </p>

            <label className="settings-field">
              <span className="settings-field__label">
                Основной текст: {Math.round(settings.printer.fontScale * 100)}%
              </span>
              <input
                type="range"
                min="0.65"
                max="1.2"
                step="0.05"
                value={settings.printer.fontScale}
                onChange={(e) => patchPrinter({ fontScale: Number(e.target.value) })}
                disabled={!settings.printer.enabled}
              />
              <span className="settings-field__hint">Товары, цены, итог</span>
            </label>

            <label className="settings-field">
              <span className="settings-field__label">
                Шапка (название): {Math.round(settings.printer.headerScale * 100)}%
              </span>
              <input
                type="range"
                min="0.7"
                max="1.1"
                step="0.05"
                value={settings.printer.headerScale}
                onChange={(e) => patchPrinter({ headerScale: Number(e.target.value) })}
                disabled={!settings.printer.enabled}
              />
              <span className="settings-field__hint">Отдельно от основного текста — уменьшите, если не влезает</span>
            </label>

            <label className="settings-field">
              <span className="settings-field__label">
                Межстрочный интервал: {settings.printer.lineSpacing.toFixed(2)}
              </span>
              <input
                type="range"
                min="0.9"
                max="1.35"
                step="0.05"
                value={settings.printer.lineSpacing}
                onChange={(e) => patchPrinter({ lineSpacing: Number(e.target.value) })}
                disabled={!settings.printer.enabled}
              />
            </label>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.printer.compactMode}
                onChange={(e) => patchPrinter({ compactMode: e.target.checked })}
                disabled={!settings.printer.enabled}
              />
              <span>Компактный чек (длинные названия переносятся чаще)</span>
            </label>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.printer.boldText}
                onChange={(e) => patchPrinter({ boldText: e.target.checked })}
                disabled={!settings.printer.enabled}
              />
              <span>Жирный текст</span>
            </label>

            <p className="settings-field__hint" style={{ marginTop: 12 }}>
              Быстрый выбор вида чека — шрифт и переносы реально попадают в печать.
            </p>
            <div className="printer-preset-grid">
              {(Object.keys(RECEIPT_LAYOUT_PRESETS) as ReceiptLayoutPresetId[]).map((id) => {
                const preset = RECEIPT_LAYOUT_PRESETS[id]
                const on = activeLayoutPreset === id
                return (
                  <button
                    key={id}
                    type="button"
                    className={`printer-preset-card${on ? ' printer-preset-card--on' : ''}`}
                    onClick={() => applyLayoutPreset(id)}
                    disabled={!settings.printer.enabled}
                  >
                    <span className="printer-preset-card__title">{preset.title}</span>
                    <span className="printer-preset-card__hint">{preset.hint}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="printer-section__group">
            <legend className="printer-section__group-title">Тип моноблока</legend>
            <p className="settings-field__hint">
              Выберите один раз — система сама выставит режим печати. Потом только «Тестовая печать».
            </p>

            <div className="printer-preset-grid">
              {(Object.keys(MONOBLOCK_PRESETS) as MonoblockPresetId[]).map((id) => {
                const preset = MONOBLOCK_PRESETS[id]
                const on = activePreset === id
                return (
                  <button
                    key={id}
                    type="button"
                    className={`printer-preset-card${on ? ' printer-preset-card--on' : ''}`}
                    onClick={() => applyPreset(id)}
                    disabled={!settings.printer.enabled}
                  >
                    <span className="printer-preset-card__title">{preset.title}</span>
                    <span className="printer-preset-card__hint">{preset.hint}</span>
                  </button>
                )
              })}
            </div>

            {isChineseLocked && (
              <p className="printer-preset-note printer-preset-note--warn">
                Режим <strong>Картинкой / Raster</strong>: чек рисуется как фото. Русский будет
                читаемым даже на «тупых» китайских принтерах. CP1251 и CP866 здесь не помогут.
              </p>
            )}
            {activePreset === 'normal' && (
              <p className="printer-preset-note">
                Режим <strong>Auto</strong>: сначала красивый чек-картинка (как preview), если не
                выйдет — текст CP1251/CP866 для нормальных принтеров.
              </p>
            )}
          </fieldset>

          <fieldset className="printer-section__group">
            <legend className="printer-section__group-title">Принтер</legend>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.printer.enabled}
                onChange={(e) => patchPrinter({ enabled: e.target.checked })}
              />
              <span>Включить печать</span>
            </label>

            <label className="settings-field">
              <span className="settings-field__label">LPT / COM</span>
              <input
                type="text"
                className="settings-field__input"
                value={settings.printer.portOrPath}
                onChange={(e) => patchPrinter({ portOrPath: e.target.value })}
                placeholder="LPT1"
                disabled={!settings.printer.enabled}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field__label">Профиль принтера</span>
              <select
                className="settings-field__select printer-section__select"
                value={settings.printer.profile}
                onChange={(e) =>
                  patchPrinter({ profile: e.target.value as PrinterProfileId })
                }
                disabled={!settings.printer.enabled}
              >
                <option value="auto">Auto</option>
                <option value="sunmi">Sunmi</option>
                <option value="posiflex">Posiflex</option>
                <option value="custom_china">Custom China POS</option>
                <option value="generic_escpos">Generic ESC/POS</option>
                <option value="legacy_chinese">Legacy Chinese POS</option>
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field__label">Режим кириллицы</span>
              <select
                className="settings-field__select printer-section__select"
                value={settings.printer.encodingMode}
                onChange={(e) =>
                  patchPrinter({ encodingMode: e.target.value as PrinterEncodingMode })
                }
                disabled={!settings.printer.enabled || isChineseLocked}
              >
                {ENCODING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {isChineseLocked && (
                <span className="settings-field__hint">
                  Заблокировано пресетом «Китайский» — только печать картинкой.
                </span>
              )}
            </label>

            {settings.printer.encodingMode === 'manual' && (
              <>
                <label className="settings-field">
                  <span className="settings-field__label">Кодировка</span>
                  <select
                    className="settings-field__select printer-section__select"
                    value={settings.printer.manualEncoding}
                    onChange={(e) =>
                      patchPrinter({
                        manualEncoding: e.target.value as AppSettings['printer']['manualEncoding'],
                      })
                    }
                  >
                    <option value="CP1251">CP1251</option>
                    <option value="CP866">CP866</option>
                    <option value="IBM866">IBM866</option>
                    <option value="KOI8-R">KOI8-R</option>
                    <option value="ISO-8859-5">ISO-8859-5</option>
                    <option value="UTF-8">UTF-8</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span className="settings-field__label">Code page</span>
                  <input
                    className="settings-field__input"
                    value={settings.printer.manualCodePage}
                    onChange={(e) => patchPrinter({ manualCodePage: e.target.value })}
                    placeholder="46 / 17"
                  />
                </label>
              </>
            )}

            {settings.printer.activeStrategyId && (
              <p className="settings-field__hint">
                Сохранённый профиль: <strong>{settings.printer.activeStrategyId}</strong>
              </p>
            )}

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.printer.printOnPayment}
                onChange={(e) => patchPrinter({ printOnPayment: e.target.checked })}
                disabled={!settings.printer.enabled}
              />
              <span>Печатать чек при оплате</span>
            </label>

            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={() => void handleTestPreviewPrint()}
              disabled={!settings.printer.enabled || testing}
            >
              {testing ? 'Печать…' : 'Тестовая печать (из Preview)'}
            </button>
            {testMsg && <p className="settings-test-result">{testMsg}</p>}
          </fieldset>
        </div>

        <ReceiptLivePreview printer={settings.printer} payload={previewPayload} />
      </div>

      <SettingsHelpFooter title="Какой моноблок — какая настройка">
        <p>
          <strong>Китайский / «тупой» моноблок</strong> (русский = каракули, иероглифы): нажмите
          пресет <strong>«Китайский / без русского»</strong>. Это режим{' '}
          <strong>Картинкой / Raster</strong> — чек печатается как фотография, точно как в preview.
          Никакой CP1251/CP866 не заставит такой принтер печатать русские буквы.
        </p>
        <p>
          <strong>Нормальный моноблок</strong> (принтер понимает русский): пресет{' '}
          <strong>«Нормальный (русский ESC/POS)»</strong> — режим Auto. Сначала красивый чек-картинка,
          при необходимости запасной текстовый вариант.
        </p>
        <p>
          После выбора пресета нажмите <strong>Тестовая печать</strong>. Если русский читаемый —
          готово. Шапку и размер текста подгоняйте слайдерами выше.
        </p>
      </SettingsHelpFooter>
    </section>
  )
}
