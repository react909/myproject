/**
 * Доступ к реквизитам магазина из любого экрана.
 *
 * Возвращает то же, что уходит в печать: кэш заполняется с сервера, а любые
 * правки в настройках сразу расходятся по подписчикам — превью чека не
 * приходится обновлять вручную.
 */

import { useEffect, useState } from 'react'
import { ONBOARDING_CHANGED_EVENT, fetchOnboarding, readOnboardingCached } from './storage'
import type { OnboardingData } from './types'

export function useOnboarding(options: { refresh?: boolean } = {}): OnboardingData {
  const { refresh = true } = options
  const [data, setData] = useState<OnboardingData>(readOnboardingCached)

  useEffect(() => {
    const sync = () => setData(readOnboardingCached())
    window.addEventListener(ONBOARDING_CHANGED_EVENT, sync)
    return () => window.removeEventListener(ONBOARDING_CHANGED_EVENT, sync)
  }, [])

  useEffect(() => {
    if (!refresh) return
    // Сбой запроса намеренно проглатывается: кэш уже отдал рабочие данные, а
    // ронять экран настроек из-за недоступного сервера незачем.
    void fetchOnboarding().catch(() => undefined)
  }, [refresh])

  return data
}
