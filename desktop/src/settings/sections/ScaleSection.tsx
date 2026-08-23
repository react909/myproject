import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useOutletContext } from 'react-router-dom'
import type { AppSettings, ScaleSpeedMode } from '../appSettings'
import { SCALE_SPEED_PRESETS } from '../appSettings'
import { SettingsHelpFooter } from '../SettingsHelpFooter'

const SPEED_OPTIONS: { id: ScaleSpeedMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Обычный', hint: 'Бережно к слабому моноблоку' },
  { id: 'fast', label: 'Быстрый', hint: 'Оптимальный баланс' },
  { id: 'turbo', label: 'Супербыстрый', hint: 'Максимальная реакция весов' },
]

type ContextType = {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}

export function ScaleSection() {
  const { settings, setSettings } = useOutletContext<ContextType>()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult('Проверка…')
    try {
      await window.devicesAPI?.applySettings?.(settings)
      const r = await window.devicesAPI?.testScale?.(settings)
      setTestResult(r?.message ?? 'Нет ответа')
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setTesting(false)
    }
  }

  const setProtocol = (protocol: AppSettings['scale']['protocol']) => {
    setSettings((prev) => ({
      ...prev,
      scale: {
        ...prev.scale,
        protocol,
        requestWeightHex: protocol === 'sum1' ? '05' : prev.scale.requestWeightHex,
      },
    }))
  }

  const setSpeedMode = (speedMode: ScaleSpeedMode) => {
    const preset = SCALE_SPEED_PRESETS[speedMode]
    setSettings((prev) => ({
      ...prev,
      scale: {
        ...prev.scale,
        speedMode,
        prDelay: preset.prDelay,
        repeatRequest: preset.repeatRequest,
      },
    }))
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Весы</h2>
      <p className="settings-section__desc">Протокол SUM, COM-порт и скорость</p>

      <div className="settings-form">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.scale.enabled}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                scale: { ...prev.scale, enabled: e.target.checked },
              }))
            }
          />
          <span>Использовать весы</span>
        </label>

        <fieldset className="settings-field">
          <span className="settings-field__label">Протокол</span>
          <label className="settings-toggle">
            <input
              type="radio"
              name="scale-protocol"
              checked={settings.scale.protocol === 'sum1'}
              onChange={() => setProtocol('sum1')}
              disabled={!settings.scale.enabled}
            />
            <span>SUM-1 (команда 05)</span>
          </label>
          <label className="settings-toggle">
            <input
              type="radio"
              name="scale-protocol"
              checked={settings.scale.protocol === 'sum2'}
              onChange={() => setProtocol('sum2')}
              disabled={!settings.scale.enabled}
            />
            <span>SUM-2 (свой HEX)</span>
          </label>
        </fieldset>

        {settings.scale.protocol === 'sum2' && (
          <label className="settings-field">
            <span className="settings-field__label">HEX команда (SUM-2)</span>
            <input
              type="text"
              className="settings-field__input"
              value={settings.scale.requestWeightHex}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  scale: { ...prev.scale, requestWeightHex: e.target.value },
                }))
              }
              disabled={!settings.scale.enabled}
            />
          </label>
        )}

        <label className="settings-field">
          <span className="settings-field__label">COM-порт</span>
          <select
            className="settings-field__select"
            value={settings.scale.comPort}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                scale: {
                  ...prev.scale,
                  comPort: e.target.value as AppSettings['scale']['comPort'],
                },
              }))
            }
            disabled={!settings.scale.enabled}
          >
            {['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-field">
          <span className="settings-field__label">Baud Rate</span>
          <select
            className="settings-field__select"
            value={settings.scale.baudRate}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                scale: {
                  ...prev.scale,
                  baudRate: Number(e.target.value) as AppSettings['scale']['baudRate'],
                },
              }))
            }
            disabled={!settings.scale.enabled}
          >
            <option value={4800}>4800</option>
            <option value={9600}>9600</option>
            <option value={19200}>19200</option>
            <option value={38400}>38400</option>
            <option value={57600}>57600</option>
            <option value={115200}>115200</option>
          </select>
        </label>

        <fieldset className="settings-field">
          <span className="settings-field__label">Скорость весов</span>
          <div className="scale-speed">
            {SPEED_OPTIONS.map(({ id, label, hint }) => (
              <button
                key={id}
                type="button"
                className={`scale-speed__btn${settings.scale.speedMode === id ? ' scale-speed__btn--on' : ''}`}
                onClick={() => setSpeedMode(id)}
                disabled={!settings.scale.enabled}
                aria-pressed={settings.scale.speedMode === id}
              >
                <span className="scale-speed__label">{label}</span>
                <span className="scale-speed__hint">{hint}</span>
              </button>
            ))}
          </div>
          <p className="settings-field__hint">
            Обычный — для слабых моноблоков, супербыстрый — мгновенная реакция (выше нагрузка).
            Опрос: {Math.round(SCALE_SPEED_PRESETS[settings.scale.speedMode].prDelay * 1000)} мс.
          </p>
        </fieldset>

        <div className="settings-test-block">
          <button
            type="button"
            className="settings-btn settings-btn--test"
            onClick={handleTest}
            disabled={!settings.scale.enabled || testing}
          >
            {testing ? 'Проверка…' : 'Тест весов'}
          </button>
          {testResult && <p className="settings-test-result">{testResult}</p>}
        </div>

        <Link to="/settings/diagnostics" className="settings-btn settings-btn--secondary">
          Расширенная диагностика →
        </Link>
      </div>

      <SettingsHelpFooter title="Весы на моноблоке">
        <p>
          Протоколы: <strong>SUM-1</strong> (команда HEX 05) и <strong>SUM-2</strong> (свой HEX) —
          стандартные протоколы весов CAS, Штрих, Масса-К и аналогов через COM. Ответ разбирается
          как текст (кг, г) или цифры в граммах.
        </p>
        <p>
          Скорость: <strong>Обычный</strong> — опрос ~500 мс, стабильность 2.2 с;{' '}
          <strong>Быстрый</strong> — ~250 мс, баланс; <strong>Супербыстрый</strong> — ~120 мс,
          реакция ~0.5–0.7 с на весах. Для большинства касс: SUM-1, COM2, 9600.
        </p>
      </SettingsHelpFooter>
    </section>
  )
}
