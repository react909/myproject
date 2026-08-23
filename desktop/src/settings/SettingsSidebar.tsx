// src/settings/SettingsSidebar.tsx

import type { ComponentType } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconSidebarDiagnostics,
  IconSidebarDisplay,
  IconSidebarPrinter,
  IconSidebarSystem,
  IconSidebarUpdates,
} from './SettingsIcons'

type SidebarItem = {
  id: string
  label: string
  path: string
  Icon: ComponentType<{ className?: string }>
}

/**
 * Обычные настройки — то, что нужно в ежедневной работе.
 *
 * Чего здесь нет и почему:
 *
 * * «Реквизиты» с логотипами, «Весы», «Оплата / QR» — это настройка установки.
 *   Её правит специалист в сервисном мастере (маршрут `/service`), там же, где
 *   заводил при установке. Держать вторую точку правки тех же полей значит
 *   однажды получить два разных ответа на вопрос «что напечатается в чеке».
 * * «Финансы», «Аналитика» и «Сотрудники» — деньги и люди магазина, дверь
 *   владельца. В обычном меню их нет ни пунктом, ни ссылкой.
 *
 * Пароля здесь не спрашивают вовсе: всё, что осталось, — ежедневная работа
 * смены. Раньше кассир упирался в запрос пароля владельца, чтобы выбрать
 * принтер.
 *
 * Список — не только меню: маршруты `/settings/*` в App.tsx обязаны совпадать с
 * ним один в один. Оставленный маршрут без пункта — это по-прежнему открытая
 * дверь, просто без вывески.
 */
const ITEMS: SidebarItem[] = [
  { id: 'printer', label: 'Печать', path: '/settings/printer', Icon: IconSidebarPrinter },
  { id: 'display', label: 'Экран', path: '/settings/display', Icon: IconSidebarDisplay },
  { id: 'system', label: 'Система', path: '/settings/system', Icon: IconSidebarSystem },
  { id: 'updates', label: 'Обновления', path: '/settings/updates', Icon: IconSidebarUpdates },
  { id: 'diagnostics', label: 'Диагностика', path: '/settings/diagnostics', Icon: IconSidebarDiagnostics },
]

export function SettingsSidebar() {
  return (
    <aside className="settings-sidebar">
      <div className="settings-sidebar__header">
        <h2>Настройки</h2>
      </div>
      <nav className="settings-sidebar__nav">
        {ITEMS.map(({ id, label, path, Icon }) => (
          <NavLink
            key={id}
            to={path}
            end
            className={({ isActive }) =>
              `settings-nav-item${isActive ? ' settings-nav-item--active' : ''}`
            }
          >
            <span className="settings-nav-item__icon">
              <Icon />
            </span>
            <span className="settings-nav-item__label">{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
