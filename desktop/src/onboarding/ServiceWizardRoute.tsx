/**
 * Сервисный проход мастера как страница.
 *
 * Отдельный тонкий слой между маршрутом и мастером: сам мастер про навигацию
 * ничего не знает и знать не должен — он умеет только «сохранить» и «выйти».
 *
 * Выход закрывает и дверь специалиста, а не только страницу. Иначе после
 * возврата на кассу открытая сессия жила бы ещё четверть часа, и повторный
 * заход в сервисный режим не спросил бы ключ.
 */

import { useNavigate } from 'react-router-dom'
import { lockAccess } from './../auth/accessKeys'
import { OnboardingWizard } from './OnboardingWizard'

export function ServiceWizardRoute() {
  const navigate = useNavigate()

  const exit = () => {
    lockAccess('specialist')
    navigate('/', { replace: true })
  }

  return <OnboardingWizard mode="service" onExit={exit} />
}
