import type { ReactNode } from 'react'
import { IconBookNote } from './SettingsIcons'
import './SettingsPage.css'

type SettingsHelpFooterProps = {
  title?: string
  children: ReactNode
}

/** Пояснение внизу экрана настроек: зачем раздел и что регулируется */
export function SettingsHelpFooter({
  title = 'Зачем этот экран',
  children,
}: SettingsHelpFooterProps) {
  return (
    <div className="settings-help-footer" role="region">
      <div className="settings-help-footer__icon" aria-hidden>
        <IconBookNote />
      </div>
      <div className="settings-help-footer__text">
        <h3 className="settings-help-footer__title">{title}</h3>
        <div className="settings-help-footer__body">{children}</div>
      </div>
    </div>
  )
}
