// src/settings/sections/DisplaySection.tsx

import { useOutletContext } from 'react-router-dom'
import type { AppSettings } from '../appSettings'
import { SettingsHelpFooter } from '../SettingsHelpFooter'

type ContextType = {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}

export function DisplaySection() {
  const { settings, setSettings } = useOutletContext<ContextType>()

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Экран</h2>
      <p className="settings-section__desc">
        Как выглядит торговый интерфейс и насколько крупно отображаются элементы
      </p>

      <div className="settings-form">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.display.largeProductCards}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                display: { ...prev.display, largeProductCards: e.target.checked },
              }))
            }
          />
          <span>Крупные карточки товара в каталоге</span>
        </label>
        <p className="settings-field__hint">
          Удобнее на сенсорном экране и при работе стоя: плитки каталога занимают больше места.
        </p>
      </div>

      <SettingsHelpFooter>
        <p>
          Раздел «Экран» отвечает за <strong>удобство чтения и нажатия</strong>: размер элементов каталога, а не
          за параметры порта или службы обновления.
        </p>
        <ul>
          <li>Автозапуск Windows, виртуальная клавиатура и полноэкранный режим задаются в «Система».</li>
          <li>COM-порты и протокол для оборудования — в «Подключение», «Весы» или «Печать» по назначению.</li>
        </ul>
        <p className="settings-help-footer__idea">
          <strong>На будущее:</strong> сохранённые пресеты внешнего вида можно будет экспортировать в файл —
          чтобы на новой кассе за минуту перенести настройку оформления.
        </p>
      </SettingsHelpFooter>
    </section>
  )
}
