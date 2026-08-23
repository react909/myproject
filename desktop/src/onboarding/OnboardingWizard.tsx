/**
 * Мастер первого запуска.
 *
 * Форма нигде не написана руками: шаги берут поля из реестра (fields.ts) и
 * рисуют их движком OnboardingForm. Реестр — дискриминированная схема по
 * режиму работы, поэтому мастер не знает, какие поля «фискальные»: он просто
 * рисует то, что реестр отдал для текущего режима. Свои контролы остались
 * только там, где поле принципиально не текстовое — режим работы, координаты,
 * чтение с кассы, сфера, склад, способы оплаты, логотип и секреты владельца.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { applyAndCacheTheme, applyStoredTheme, applyTheme } from '../auth/applyTheme'
import type { ThemeMode } from '../auth/applyTheme'
import client from '../api/client'
import { prepareAccountSession } from '../services/accountSession'
import { brandTheme, resolveBrand } from '../brand/brand'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { AnalyticsModePicker } from './AnalyticsModePicker'
import { clearDraft, draftAgeLabel, draftHasContent, readDraft, saveDraft } from './draft'
import { LogoStudio } from './LogoStudio'
import {
  AccentPicker,
  BrandModePicker,
  AppHeaderEditor,
  ReceiptLogoEditor,
  rebuildLogoVariants,
} from './BrandEditor'
import { OnboardingSection } from './OnboardingForm'
import { FiscalModePicker } from './FiscalModePicker'
import { KkmInfoBlock } from './KkmInfoBlock'
import { OutletGeoPicker } from './OutletGeoPicker'
import { PaymentProvidersEditor } from './PaymentProvidersEditor'
import { ReceiptPreview } from './ReceiptPreview'
import { ReviewStep } from './ReviewStep'
import { MINIMUM_MS, ServiceLoading } from './ServiceLoading'
import { TaxNote } from './TaxNote'
import { INDUSTRIES, industryById } from './industries'
import type { IndustryId } from './industries'
import {
  ACCOUNT_STEP,
  FORM_STEPS,
  LAST_STEP,
  STEPS,
  problemsForStep,
  sectionsForStep,
  validateField,
} from './fields'
import type { FieldDef, FieldProblem } from './fields'
import { currencyByCode } from './dictionaries'
import { fetchOnboarding, onboardingErrorText, saveOnboarding, submitSetup } from './storage'
import {
  EDITIONS,
  OWNER_PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH,
  PAYMENT_METHODS,
  applyFiscalMode,
  createOnboardingDraft,
  effectiveOwnerEmail,
  isOwnerEmailLinked,
} from './types'
import type {
  BrandingData,
  Edition,
  FiscalMode,
  KkmData,
  OnboardingData,
  OutletData,
  OwnerSecrets,
  PaymentMethodId,
} from './types'
import { secretProblems } from './validation'
import './OnboardingWizard.css'

/**
 * Два режима одного мастера.
 *
 * `setup` — первая установка: база ещё пустая, в конце создаётся владелец и
 * сессия через POST /api/setup/init.
 *
 * `service` — сервисный проход специалиста. Тот же мастер и те же шаги, но
 * установка уже сделана: поля приезжают с сервера, сохранение идёт через PATCH
 * /api/settings/store, а `init` не вызывается вообще — повторная установка
 * затёрла бы работающий магазин.
 *
 * Разными компонентами это делать нельзя: шаги, поля и проверки обязаны
 * совпадать с тем, что проходили при установке, иначе специалист правит
 * что-то одно, а клиент видел другое.
 */
export type WizardMode = 'setup' | 'service'

type Props =
  | {
      mode?: 'setup'
      setupToken: string
      onDone: (username: string) => void
      onNotify?: (message: string) => void
    }
  | {
      mode: 'service'
      /** Выход из сервисного режима: по кнопке, по бездействию, по сохранению. */
      onExit: () => void
      onNotify?: (message: string) => void
    }

/**
 * Через сколько бездействия сервисный проход закрывается сам.
 *
 * Десять минут: столько специалист может провозиться с принтером, не касаясь
 * экрана. Дольше держать открытым нельзя — мастер стоит на кассе, и уехавший
 * установщик не должен оставлять его открытым для кого угодно.
 */
export const SERVICE_IDLE_MS = 10 * 60 * 1000

const PASSWORD_LABELS = ['Слишком короткий', 'Слабый', 'Средний', 'Надёжный'] as const

/** Номера полей ККМ, которые запираются после успешного чтения с устройства. */
const KKM_READ_FIELDS = ['kkm.serialNumber', 'kkm.registrationNumber', 'kkm.fiscalModule']

function passwordScore(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0
  let score = 0
  if (password.length >= PASSWORD_MIN_LENGTH) score += 1
  if (password.length >= 12) score += 1
  if (/[a-zA-Zа-яА-Я]/.test(password) && /\d/.test(password)) score += 1
  if (/[^\w\s]/.test(password)) score += 1
  return Math.min(3, score) as 0 | 1 | 2 | 3
}

export function pluralize(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`
  if (mod10 === 1) return `${count} ${one}`
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`
  return `${count} ${many}`
}

export function OnboardingWizard(props: Props) {
  const { onNotify } = props
  const service = props.mode === 'service'
  // Черновик — только для первой установки. В сервисном проходе источник истины
  // один: то, что сейчас лежит на сервере. Подсунуть туда черновик полугодовой
  // давности значит молча откатить магазин к его первому дню.
  const [restored] = useState(() => {
    if (props.mode === 'service') return null
    const draft = readDraft()
    return draft && draftHasContent(draft) ? draft : null
  })
  const [data, setData] = useState<OnboardingData>(() => restored?.data ?? createOnboardingDraft())
  /* Сервисный проход ждёт данные с сервера: до них форму показывать нельзя —
     пустые поля человек примет за «настройка потерялась». */
  const [loading, setLoading] = useState(service)
  // Пароль и сервисный ключ живут отдельно от онбординга: он кэшируется и
  // уходит в настройки, а секретам там не место. В черновик они тоже не
  // попадают — localStorage это обычный файл профиля.
  const [secrets, setSecrets] = useState<OwnerSecrets>({ password: '', ownerPassword: '' })
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showSecrets, setShowSecrets] = useState(false)
  const [draftNoticeShown, setDraftNoticeShown] = useState(Boolean(restored))

  const [step, setStep] = useState(() => Math.min(restored?.step ?? 0, LAST_STEP))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [focusFieldId, setFocusFieldId] = useState('')
  // Считанные с кассы номера правке не подлежат, пока их явно не разблокируют.
  // Состояние сессии мастера: в данные оно не входит и на сервер не уходит.
  const [kkmLocked, setKkmLocked] = useState(false)

  const secretIssues = useMemo(
    () => secretProblems(data, secrets, passwordConfirm),
    [data, secrets, passwordConfirm],
  )

  /*
   * Черновик пишется с паузой после последней правки, а не на каждую букву:
   * JSON.stringify всей формы на каждый набранный символ — заметная работа на
   * слабой машине. Полсекунды человек не замечает, а закрытие окна переживает.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => saveDraft(data, step), 500)
    return () => window.clearTimeout(timer)
  }, [data, step])

  /* Закрытие окна может случиться раньше, чем сработает таймер выше, —
     сохраняем ещё и синхронно на выходе. */
  useEffect(() => {
    const flush = () => saveDraft(data, step)
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [data, step])

  /** Проблемы шага с учётом секретов, которых нет в реестре данных. */
  /**
   * Порядок шагов.
   *
   * В сервисном проходе «Учётная запись» выпадает целиком: пароль владельца
   * специалисту недоступен даже на чтение, а заводить владельца заново нечего —
   * он уже есть. Сервисный ключ при этом менять можно, и его поле живёт на
   * шаге оформления доступа, а не здесь.
   */
  const stepOrder = useMemo(
    () => STEPS.map((_, index) => index).filter((index) => !service || index !== ACCOUNT_STEP),
    [service],
  )

  const blockingFor = useCallback(
    (target: number): FieldProblem[] => {
      // Шага нет в проходе — и претензий к нему быть не может. Иначе сервисный
      // проход упирался бы в пустой пароль владельца, которого не показывает.
      if (!stepOrder.includes(target)) return []
      return target === ACCOUNT_STEP
        ? [...problemsForStep(ACCOUNT_STEP, data), ...secretIssues]
        : problemsForStep(target, data)
    },
    [data, secretIssues, stepOrder],
  )

  const allBlocking = useMemo(
    () => stepOrder.flatMap((index) => blockingFor(index)),
    [blockingFor, stepOrder],
  )

  /*
    Сервисный проход начинается с чтения текущих реквизитов.

    Именно с сервера, а не из кэша: кэш мог остаться от прошлой смены или от
    другого прохода, а специалист правит то, что напечатается в чеке сегодня.
    До ответа форма не показывается вовсе — пустые поля читаются как «настройка
    потерялась», и человек начинает заполнять их заново.
  */
  useEffect(() => {
    if (!service) return undefined
    let cancelled = false
    setLoading(true)
    /* Экран подготовки держится минимум MINIMUM_MS. Не ради солидности: на
       быстрой машине ответ приходит за сотню миллисекунд, экран мелькает, и
       мелькание читается хуже спокойной паузы — глаз замечает движение, но не
       успевает прочитать, что происходит. */
    const shownAt = Date.now()
    void fetchOnboarding()
      .then((loaded) => {
        if (cancelled) return
        setData(loaded)
        // То, что лежит на сервере, и есть текущее оформление кассы. Кладём
        // его в кэш сразу: именно к нему возвращает выход без сохранения, и
        // без этой строки возвращаться было бы не к чему на установке, где
        // мастер проходили ещё до появления кэша.
        applyAndCacheTheme(brandTheme(loaded.branding))
      })
      .catch((caught) => {
        if (!cancelled) setError(onboardingErrorText(caught))
      })
      .finally(() => {
        if (cancelled) return
        const left = Math.max(0, MINIMUM_MS - (Date.now() - shownAt))
        window.setTimeout(() => {
          if (!cancelled) setLoading(false)
        }, left)
      })
    return () => {
      cancelled = true
    }
  }, [service])

  /*
    Бездействие закрывает сервисный проход.

    Отсчёт сбрасывает любое касание экрана или клавиши: мастер стоит на кассе,
    и уехавший установщик не должен оставлять его открытым для кого угодно.
    Слушатели на весь документ, потому что мастер занимает экран целиком.
  */
  useEffect(() => {
    if (!service) return undefined
    const exit = props.mode === 'service' ? props.onExit : () => {}
    let timer = 0
    const restart = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(exit, SERVICE_IDLE_MS)
    }
    const events: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel']
    events.forEach((name) => document.addEventListener(name, restart, { passive: true }))
    restart()
    return () => {
      window.clearTimeout(timer)
      events.forEach((name) => document.removeEventListener(name, restart))
    }
    // props.onExit намеренно не в зависимостях: пересоздавать таймер на каждую
    // отрисовку родителя значит никогда его не досчитать.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service])

  /*
    Живое превью акцента: цвет применяется ко всему приложению сразу, без
    перезагрузки и без кнопки «применить».

    Без записи в кэш, и это важно. Кэш — то, чем приложение красится при
    следующем запуске, а здесь человек ещё выбирает и вправе уйти, ничего не
    сохранив (см. возврат при размонтировании ниже). Записывают кэш только два
    места — успешное сохранение сервисного прохода и завершение установки.
  */
  useEffect(() => {
    applyTheme(brandTheme(data.branding))
    // Через brandTheme, а не по полям напрямую: возврат к заводскому бренду
    // обязан вернуть мятный #00f5bc сразу, не дожидаясь сохранения, — хотя в
    // `primaryColor` при этом продолжает лежать цвет, выбранный клиентом.
  }, [data.branding.theme, data.branding.primaryColor, data.branding.useFactoryBrand])

  /*
    Выход без сохранения возвращает прежний цвет.

    Иначе примерка оставалась бы на экране: специалист покрутил цвета,
    передумал, нажал «Выйти без сохранения» — и касса до перезапуска стоит в
    неутверждённом цвете, которого нет ни в базе, ни в кэше.

    Флаг, а не список зависимостей: возвращать надо ровно тогда, когда мастер
    закрылся, ничего не записав.
  */
  const themeSavedRef = useRef(false)
  useEffect(
    () => () => {
      if (!themeSavedRef.current) applyStoredTheme()
    },
    [],
  )

  /* Валюта в чеке печатается символом, а выбирается кодом — держим пару
     согласованной в одном месте, а не в каждом потребителе. */
  useEffect(() => {
    const currency = currencyByCode(data.business.currency)
    if (currency.symbol !== data.business.currencyLabel) {
      setData((prev) => ({ ...prev, business: { ...prev.business, currencyLabel: currency.symbol } }))
    }
  }, [data.business.currency, data.business.currencyLabel])

  /* Связка «email владельца совпадает с email компании»: пока она действует,
     поле владельца зеркалит компанию. В базе поля всё равно разные.

     Условие берётся из isOwnerEmailLinked, а не проверяется здесь руками.
     Раньше эффект смотрел только на галку и не смотрел на режим — а галка
     стоит по умолчанию, тогда как в простом режиме её даже не показывают.
     Из-за этого email владельца в простом режиме стирался на каждой набранной
     букве: эффект зеркалил в него пустой адрес компании. */
  useEffect(() => {
    if (!isOwnerEmailLinked(data)) return
    if (data.owner.email === data.contacts.email) return
    setData((prev) => ({ ...prev, owner: { ...prev.owner, email: prev.contacts.email } }))
  }, [data])

  const patchBranding = useCallback((patch: Partial<BrandingData>) => {
    setData((prev) => ({ ...prev, branding: { ...prev.branding, ...patch } }))
  }, [])

  /**
   * Правка шапки приложения: компоновка, надпись, оформление названия.
   *
   * Отдельно от `patchBranding` только по смыслу — размеры знака отсюда не
   * пересобираются: сам знак этот блок не трогает, он живёт в редакторе
   * логотипа, а надпись и единая картинка приходят готовыми файлами.
   */
  const patchHeader = useCallback((patch: Partial<BrandingData>) => {
    setData((prev) => ({ ...prev, branding: { ...prev.branding, ...patch } }))
  }, [])

  useEffect(() => {
    const { branding } = data
    if (branding.useFactoryBrand || !branding.logoMark) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      void rebuildLogoVariants(branding)
        .then((patch) => {
          if (cancelled || !patch.logoVariants) return
          setData((prev) => ({ ...prev, branding: { ...prev.branding, ...patch } }))
        })
        .catch(() => undefined)
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Пересобираем только на смену самого знака: название в картинку не
    // запекается, а `logo` и есть результат пересборки — включать его сюда
    // значит зациклиться.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.branding.logoMark, data.branding.useFactoryBrand])

  const patchOutlet = useCallback((patch: Partial<OutletData>) => {
    setData((prev) => ({ ...prev, outlet: { ...prev.outlet, ...patch } }))
  }, [])

  const patchKkm = useCallback((patch: Partial<KkmData>) => {
    setData((prev) => ({ ...prev, kkm: { ...prev.kkm, ...patch } }))
  }, [])

  /** Последствия смены режима описаны в applyFiscalMode, а не здесь. */
  const setFiscalMode = useCallback((fiscalMode: FiscalMode) => {
    setError('')
    setData((prev) => applyFiscalMode(prev, fiscalMode))
  }, [])

  /* Ходим по видимому порядку шагов, а не по номерам подряд: в сервисном
     проходе «Учётной записи» в нём нет, и +1 перепрыгнул бы через неё сам. */
  const position = Math.max(0, stepOrder.indexOf(step))

  const goNext = () => {
    const blocking = blockingFor(step)
    if (blocking.length) {
      setShowErrors(true)
      setError(blocking[0].message)
      return
    }
    setShowErrors(false)
    setError('')
    setStep(stepOrder[Math.min(stepOrder.length - 1, position + 1)])
  }

  const goBack = () => {
    setError('')
    setStep(stepOrder[Math.max(0, position - 1)])
  }

  const goTo = (target: number) => {
    if (target <= step) {
      setError('')
      setStep(target)
      return
    }
    for (const index of stepOrder) {
      if (index >= target) break
      if (index < step) continue
      const blocking = blockingFor(index)
      if (blocking.length) {
        setShowErrors(true)
        setError(blocking[0].message)
        setStep(index)
        return
      }
    }
    setError('')
    setStep(target)
  }

  /** Переход со сводки: сразу к нужному полю, а не «куда-то на шаг». */
  const fixField = (field: FieldDef) => {
    setShowErrors(true)
    setError('')
    setStep(field.step)
    setFocusFieldId('')
    // Сброс перед установкой: повторный клик по тому же полю тоже должен
    // сработать, а не остаться прежним значением состояния.
    window.setTimeout(() => setFocusFieldId(field.id), 0)
  }

  /**
   * Сохранение сервисного прохода.
   *
   * Только PATCH. `POST /api/setup/init` здесь не вызывается ни при каких
   * условиях: он создаёт базу и владельца заново, то есть стирает работающий
   * магазин. Права проверяет сервер — правку реквизитов пускает только
   * открытая сессия специалиста, и каждое сохранение он же пишет в журнал со
   * старым и новым значением каждого поля.
   */
  const saveService = async () => {
    if (allBlocking.length) {
      setShowErrors(true)
      setError('Остались незаполненные поля — они отмечены в сводке.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveOnboarding(data)
      applyAndCacheTheme(brandTheme(data.branding))
      themeSavedRef.current = true
      onNotify?.('Настройки сохранены')
      if (props.mode === 'service') props.onExit()
    } catch (caught) {
      setError(onboardingErrorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (allBlocking.length) {
      setShowErrors(true)
      setError('Остались незаполненные поля — они отмечены в сводке.')
      return
    }

    // Сюда сервисный проход не попадает: у него свой путь через PATCH, а
    // init создал бы магазин заново поверх работающего.
    if (props.mode === 'service') return

    setBusy(true)
    setError('')
    try {
      const email = effectiveOwnerEmail(data)
      const result = await submitSetup(props.setupToken, data, { ...secrets })

      // База создана — черновик больше не нужен и не должен всплыть при
      // повторном проходе мастера со старыми реквизитами.
      clearDraft()

      localStorage.setItem('nurcrm-token', result.accessToken)
      localStorage.setItem('nurcrm-user-email', email)
      localStorage.setItem('nurcrm-last-username', email)
      localStorage.setItem('nurcrm-api-url', 'http://127.0.0.1:8000')
      localStorage.setItem('nurcrm-user', JSON.stringify(result.user))
      applyAndCacheTheme(brandTheme(data.branding))
      themeSavedRef.current = true
      prepareAccountSession(email)

      // Стартовые категории берутся из пресета выбранной сферы.
      const preset = industryById(data.business.industry)
      for (const [index, name] of preset.categories.entries()) {
        try {
          await client.post('/api/categories', { name, sort_order: index })
        } catch {
          /* сид категорий — best effort, не блокирует запуск */
        }
      }

      onNotify?.('Kassir ERP готов к работе')
      props.onDone(email)
    } catch (caught) {
      setError(onboardingErrorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (step !== LAST_STEP) {
      goNext()
      return
    }
    void (service ? saveService() : finish())
  }

  // Бренд для рельса мастера. Пересчитывается на правку оформления, поэтому
  // логотип и название в рельсе меняются прямо во время настройки — это часть
  // живого превью, а не отдельная его копия.
  const brand = resolveBrand(data.branding)

  const isReview = step === LAST_STEP
  const progress = Math.round(((step + 1) / STEPS.length) * 100)
  const suggestedName = data.company.shortName || data.outlet.name || data.company.legalName
  const lockedFieldIds = useMemo(
    () => new Set(kkmLocked ? KKM_READ_FIELDS : []),
    [kkmLocked],
  )

  const renderCustom = (field: FieldDef) => {
    switch (field.id) {
      case 'fiscalMode':
        return <FiscalModePicker value={data.fiscalMode} onChange={setFiscalMode} />
      case 'edition':
        return (
          <EditionPicker
            value={data.edition}
            onChange={(edition) => setData((prev) => ({ ...prev, edition }))}
          />
        )
      case 'outlet.coords':
        return (
          <OutletGeoPicker
            data={data}
            onChange={patchOutlet}
            error={showErrors ? validateField(field, data) : ''}
          />
        )
      case 'kkm.reader':
        return (
          <KkmInfoBlock
            kkm={data.kkm}
            onChange={patchKkm}
            locked={kkmLocked}
            onLockedChange={setKkmLocked}
          />
        )
      case 'business.industry':
        return (
          <IndustryPicker
            value={data.business.industry}
            onChange={(industry) =>
              setData((prev) => ({ ...prev, business: { ...prev.business, industry } }))
            }
          />
        )
      case 'tax.note':
        return <TaxNote data={data} />
      case 'business.analyticsMode':
        return (
          <AnalyticsModePicker
            value={data.business.analyticsMode}
            onChange={(analyticsMode) =>
              setData((prev) => ({ ...prev, business: { ...prev.business, analyticsMode } }))
            }
          />
        )
      case 'acquiring.methods':
        return (
          <PaymentMethodPicker
            value={data.acquiring.methods}
            onChange={(update) =>
              setData((prev) => ({
                ...prev,
                acquiring: { ...prev.acquiring, methods: update(prev.acquiring.methods) },
              }))
            }
          />
        )
      case 'acquiring.providers':
        return (
          <PaymentProvidersEditor
            value={data.acquiring.providers}
            onChange={(update) =>
              setData((prev) => ({
                ...prev,
                acquiring: { ...prev.acquiring, providers: update(prev.acquiring.providers) },
              }))
            }
            // База ещё не создана, авторизации нет — ключ уходит на сервер
            // после запуска, из настроек.
            deferSecrets
          />
        )
      case 'branding.factoryBrand':
        return (
          <BrandModePicker
            value={data.branding.useFactoryBrand}
            onChange={(useFactoryBrand) => patchBranding({ useFactoryBrand })}
          />
        )
      case 'branding.logo':
        return (
          <LogoStudio
            branding={data.branding}
            suggestedName={suggestedName}
            onChange={patchBranding}
            onError={setError}
          />
        )
      case 'branding.logoTextEditor':
        return (
          <AppHeaderEditor
            branding={data.branding}
            onChange={patchHeader}
            onError={setError}
          />
        )
      case 'branding.primaryColor':
        return (
          <AccentPicker
            value={data.branding.primaryColor}
            mode={data.branding.theme}
            branding={data.branding}
            onChange={(primaryColor) => patchBranding({ primaryColor })}
          />
        )
      case 'branding.receiptLook':
        return (
          <ReceiptLogoEditor branding={data.branding} onChange={patchBranding} onError={setError} />
        )
      case 'branding.theme':
        return (
          <ThemePicker
            value={data.branding.theme}
            accent={data.branding.primaryColor}
            onChange={(theme) => patchBranding({ theme })}
          />
        )
      case 'branding.receiptPreview':
        return <ReceiptPreview data={data} />
      case 'owner.email':
        return (
          <OwnerEmailField
            data={data}
            showErrors={showErrors}
            onEmailChange={(email) => setData((prev) => ({ ...prev, owner: { ...prev.owner, email } }))}
            onLinkChange={(emailSameAsCompany) =>
              setData((prev) => ({
                ...prev,
                owner: {
                  ...prev.owner,
                  emailSameAsCompany,
                  email: emailSameAsCompany ? prev.contacts.email : prev.owner.email,
                },
              }))
            }
          />
        )
      case 'owner.password':
        return (
          <PasswordField
            value={secrets.password}
            confirm={passwordConfirm}
            reveal={showSecrets}
            onReveal={() => setShowSecrets((value) => !value)}
            onChange={(password) => setSecrets((prev) => ({ ...prev, password }))}
            onConfirmChange={setPasswordConfirm}
          />
        )
      case 'owner.ownerPassword':
        return (
          <OwnerPasswordField
            value={secrets.ownerPassword}
            accountPassword={secrets.password}
            onChange={(ownerPassword) => setSecrets((prev) => ({ ...prev, ownerPassword }))}
          />
        )
      default:
        return null
    }
  }

  /* Сервисный проход ждёт данные с сервера: показать пустую форму — значит
     дать специалисту заполнить её заново поверх работающей настройки. */
  if (loading) {
    /*
      Без обёртки `.ow` — и это исправление настоящей ошибки.

      `.ow` это сетка мастера: колонка рельса 248 px и колонка содержимого.
      Экран подготовки, положенный внутрь неё, попадал в первую колонку и
      сжимался до ширины рельса: заголовок ломался на две строки, шаги — на
      три. Собственной сетки у него нет, и лежать в чужой ему незачем.
    */
    return <ServiceLoading />
  }

  const exitService = () => {
    if (props.mode === 'service') props.onExit()
  }

  return (
    <main className={`ow${service ? ' ow--service' : ''}`} data-no-virtual-keyboard>
      <aside className="ow__rail">
        {/*
          Знак и название — из общего источника, а не свои.

          Именно здесь и была видна расхождение: рельс мастера рисовал жёстко
          зашитый файл, а шапка кассы — логотип, загруженный клиентом. Один и
          тот же магазин выглядел в мастере одной программой, а на кассе
          другой. Теперь оба места спрашивают resolveBrand.
        */}
        <div className="ow__brand">
          <img src={brand.mark} alt="" />
          <div>
            <strong>{service ? 'Сервисная настройка' : brand.name}</strong>
            <span>{service ? 'Правка настроек установки' : 'Мастер первого запуска'}</span>
          </div>
        </div>

        <ol className="ow__steps">
          {/* Активация уже позади — показываем её отмеченной, чтобы нумерация
              шагов совпадала с тем, что человек прошёл на самом деле. */}
          <li className="ow__step is-done ow__step--static">
            <span>
              <span className="ow__step-marker">✓</span>
              <span className="ow__step-text">
                <strong>Активация</strong>
                <small>Лицензия активирована</small>
              </span>
            </span>
          </li>

          {stepOrder.map((index, order) => {
            const item = STEPS[index]
            const state = index === step ? 'is-active' : index < step ? 'is-done' : ''
            const issues = blockingFor(index)
            const flagged = showErrors && issues.length > 0
            return (
              <li key={item.title} className={`ow__step ${state}${flagged ? ' is-flagged' : ''}`}>
                <button type="button" onClick={() => goTo(index)} disabled={busy}>
                  <span className="ow__step-marker">
                    {index < step && !flagged ? '✓' : order + 1}
                  </span>
                  <span className="ow__step-text">
                    <strong>{item.title}</strong>
                    <small>
                      {flagged
                        ? `${pluralize(issues.length, 'поле', 'поля', 'полей')} не заполнено`
                        : item.caption}
                    </small>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        <div className="ow__rail-foot">
          <dl className="ow__meta">
            <div>
              <dt>Режим</dt>
              <dd>{data.fiscalMode === 'fiscal' ? 'Фискальный' : 'Без фискальной кассы'}</dd>
            </div>
            <div>
              <dt>Хранилище</dt>
              <dd>SQLite · WAL</dd>
            </div>
          </dl>
          <p className="ow__rail-note">Данные не покидают это устройство.</p>
        </div>
      </aside>

      <div className="ow__main">
        <header className="ow__topbar">
          <div className="ow__topbar-text">
            <span className="ow__eyebrow">
              {service
                ? isReview
                  ? 'Сервисная настройка · проверка'
                  : `Сервисная настройка · шаг ${position + 1} из ${stepOrder.length - 1}`
                : isReview
                  ? 'Финальная проверка'
                  : `Шаг ${step + 1} из ${FORM_STEPS}`}
            </span>
            <h1>{STEPS[step].title}</h1>
            <p>{STEPS[step].caption}</p>
          </div>
          {/* Выход на каждом шаге, а не только в конце: специалист приходит
              поправить одно поле и должен уметь уйти, ничего не сохранив. */}
          {service && (
            <button
              type="button"
              className="ow__service-exit"
              onClick={exitService}
              disabled={busy}
            >
              Выйти без сохранения
            </button>
          )}
          <div
            className="ow__progress"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="ow__progress-value">{progress}%</span>
            <span className="ow__progress-track">
              <i style={{ width: `${progress}%` }} />
            </span>
          </div>
        </header>

        {/* Черновик восстановлен молча, но сказать об этом надо: человек
            открыл мастер и увидел заполненные поля — он должен понимать,
            откуда они, и иметь возможность начать с чистого листа. */}
        {draftNoticeShown && restored && (
          <div className="ow__draft-note" role="status">
            <span>
              Продолжаем с того места, где остановились ({draftAgeLabel(restored.savedAt)}). Пароль и
              сервисный ключ нужно ввести заново — они не сохраняются.
            </span>
            <div className="ow__draft-note-actions">
              <button
                type="button"
                onClick={() => {
                  clearDraft()
                  setData(createOnboardingDraft())
                  setStep(0)
                  setDraftNoticeShown(false)
                }}
              >
                Начать заново
              </button>
              <button type="button" onClick={() => setDraftNoticeShown(false)}>
                Понятно
              </button>
            </div>
          </div>
        )}

        <form className="ow__form" onSubmit={submit}>
          <div className="ow__body">
            {/*
              Граница вокруг содержимого шага, а не всего мастера: подвал с
              «Назад» и «Продолжить» остаётся рабочим, и человек уходит с
              битого шага, не теряя заполненного. Раньше исключение в рендере
              снимало всё дерево — оставался белый экран.
            */}
            <ErrorBoundary scope={`wizard:step-${step}`} onReset={() => setStep(0)}>
            <CrashProbe />
            {isReview ? (
              <ReviewStep
                data={data}
                secretIssues={secretIssues}
                onFix={fixField}
                onEditStep={goTo}
              />
            ) : (
              <section className="ow__section">
                {sectionsForStep(step, data).map(({ section, fields }) => (
                  <OnboardingSection
                    key={section}
                    section={section}
                    fields={fields}
                    data={data}
                    onChange={setData}
                    showErrors={showErrors}
                    focusFieldId={focusFieldId}
                    renderCustom={renderCustom}
                    lockedFieldIds={lockedFieldIds}
                    // Свёрнутую секцию с ошибкой раскрываем: иначе сообщение
                    // «заполните поле» указывает в закрытый блок.
                    forceOpen={
                      showErrors && fields.some((field) => validateField(field, data))
                    }
                  />
                ))}
              </section>
            )}
            </ErrorBoundary>
          </div>

          <footer className="ow__footer">
            <div className="ow__footer-msg" role="status" aria-live="polite">
              {error ? (
                <p className="ow__error">{error}</p>
              ) : isReview && allBlocking.length > 0 ? (
                <p className="ow__error">
                  Не хватает: {allBlocking.slice(0, 3).map((item) => item.field.label).join(', ')}
                  {allBlocking.length > 3 ? ` и ещё ${allBlocking.length - 3}` : ''}
                </p>
              ) : isReview ? (
                <p className="ow__ready">Всё заполнено. Можно создавать базу.</p>
              ) : null}
            </div>
            <div className="ow__footer-actions">
              <button type="button" className="ow__btn ow__btn--ghost" onClick={goBack} disabled={busy || step === 0}>
                Назад
              </button>
              {/* Кнопки «Стандарт» здесь больше нет: рядом с «Продолжить» она
                  читалась как выбор тарифа, а сбрасывала заполненный шаг.
                  Тариф выбирается своим блоком на первом шаге. */}
              <button
                type="submit"
                className="ow__btn ow__btn--primary"
                disabled={busy || (isReview && allBlocking.length > 0)}
              >
                {busy ? 'Создание базы…' : isReview ? 'Запустить Kassir ERP' : 'Продолжить'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </main>
  )
}

/* -------------------------------------------------------------------------- */
/* Свои контролы                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Искусственное падение шага — проверка границы ошибок.
 *
 * Граница нужна ровно на случай, который невозможно предвидеть, и проверить её
 * можно только уронив шаг нарочно. В консоли dev-сборки:
 *
 *     localStorage.setItem('nurcrm-debug-throw', '1'); location.reload()
 *
 * Вместо белого экрана должна появиться карточка «Что-то пошло не так» с
 * кнопкой возврата, а подвал с «Назад» и «Продолжить» — остаться рабочим.
 * В собранном приложении `import.meta.env.DEV` ложно, и код сюда не попадает.
 */
function CrashProbe() {
  if (import.meta.env.DEV && localStorage.getItem('nurcrm-debug-throw') === '1') {
    throw new Error('Проверка границы ошибок: искусственное падение шага мастера.')
  }
  return null
}

function IndustryPicker({
  value,
  onChange,
}: {
  value: IndustryId
  onChange: (industry: IndustryId) => void
}) {
  return (
    <div className="ow__cards" role="radiogroup" aria-label="Сфера бизнеса">
      {INDUSTRIES.map((preset) => {
        const selected = value === preset.id
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`ow__card${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(preset.id)}
          >
            <span className="ow__card-head">
              <strong>{preset.title}</strong>
              <span className="ow__radio" aria-hidden="true">
                <i />
              </span>
            </span>
            {/* Одна строка о том, что именно включится — сфера не косметика. */}
            <p>{preset.enables}</p>
          </button>
        )
      })}
    </div>
  )
}

/*
 * AnalyticsModePicker живёт в своём файле: он нужен и мастеру, и настройкам
 * владельца — режим переключается в любой момент, а не только при установке.
 */

/**
 * Тариф установки.
 *
 * Переключатель-сегмент, как ширина рулона на шаге оформления: вариантов два,
 * они взаимоисключающие, и решение это не разовое — тариф меняют и после
 * запуска. Под каждым — строка о том, что входит; цен здесь нет намеренно, их
 * в программе не знают и знать не должны.
 */
function EditionPicker({
  value,
  onChange,
}: {
  value: Edition
  onChange: (edition: Edition) => void
}) {
  return (
    <div className="ow__editions" role="radiogroup" aria-label="Тариф">
      {EDITIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={value === item.id}
          className={`ow__edition${value === item.id ? ' is-selected' : ''}`}
          onClick={() => onChange(item.id)}
        >
          <strong>{item.label}</strong>
          <small>{item.note}</small>
        </button>
      ))}
    </div>
  )
}

function PaymentMethodPicker({
  value,
  onChange,
}: {
  value: PaymentMethodId[]
  /** Функция от предыдущего набора — см. ProvidersUpdate в редакторе оплаты. */
  onChange: (update: (previous: PaymentMethodId[]) => PaymentMethodId[]) => void
}) {
  const toggle = (id: PaymentMethodId) => {
    // Наличные отключить нельзя — касса обязана их принимать.
    if (id === 'cash') return
    // От предыдущего значения, а не от пропсов: две галочки, нажатые в один
    // кадр, иначе затирали бы друг друга — сработала бы только последняя.
    onChange((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    )
  }

  return (
    <div className="ow__methods">
      {PAYMENT_METHODS.map((method) => {
        const checked = value.includes(method.id)
        const locked = method.id === 'cash'
        return (
          <label
            key={method.id}
            className={`ow__method${checked ? ' is-checked' : ''}${locked ? ' is-locked' : ''}`}
          >
            <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggle(method.id)} />
            <span>
              <strong>{method.label}</strong>
              <small>{locked ? 'Всегда включены' : method.hint}</small>
            </span>
          </label>
        )
      })}
    </div>
  )
}

function ThemePicker({
  value,
  accent,
  onChange,
}: {
  value: ThemeMode
  accent: string
  onChange: (theme: ThemeMode) => void
}) {
  return (
    <div className="ow__themes">
      {(['light', 'dark'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`ow__theme${value === mode ? ' is-selected' : ''}`}
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
        >
          <span className="ow__theme-thumb" data-mode={mode}>
            <i className="ow__theme-rail" />
            <i className="ow__theme-bar" style={{ background: accent }} />
            <i className="ow__theme-line" />
            <i className="ow__theme-line is-short" />
          </span>
          <strong>{mode === 'light' ? 'Светлая' : 'Тёмная'}</strong>
        </button>
      ))}
    </div>
  )
}

function OwnerEmailField({
  data,
  showErrors,
  onEmailChange,
  onLinkChange,
}: {
  data: OnboardingData
  showErrors: boolean
  onEmailChange: (email: string) => void
  onLinkChange: (linked: boolean) => void
}) {
  // Связка возможна только там, где email компании вообще спрашивают.
  const linkable = data.fiscalMode === 'fiscal'
  const linked = isOwnerEmailLinked(data)
  const value = linked ? data.contacts.email : data.owner.email
  const invalid = showErrors && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

  return (
    <div className="ow__owner-email">
      <span className="ob-label">
        Email владельца
        <b aria-hidden="true"> *</b>
      </span>
      <input
        className={`ob-control${invalid ? ' is-invalid' : ''}`}
        type="email"
        value={value}
        // Поле не блокируется даже при включённой связке: заблокированный
        // инпут, в который человек пытается печатать, читается как «программа
        // не работает». Вместо этого набор сам снимает связку и оставляет
        // введённое — намерение очевидно, объяснять его галкой незачем.
        autoComplete="email"
        spellCheck={false}
        placeholder="owner@example.kg"
        onChange={(event) => {
          if (linked) onLinkChange(false)
          onEmailChange(event.target.value)
        }}
      />
      {linkable && (
        <label className="ow__link-check">
          <input type="checkbox" checked={linked} onChange={(event) => onLinkChange(event.target.checked)} />
          <span>Совпадает с email компании</span>
        </label>
      )}
      <small className={`ob-hint${invalid ? ' is-invalid' : ''}`}>
        {invalid
          ? 'Укажите действующий email — без него не войти в систему.'
          : linked
            ? 'Взят из email компании. Начните печатать, чтобы указать другой.'
            : 'Этот email — ваш логин и способ восстановить доступ.'}
      </small>
    </div>
  )
}

function PasswordField({
  value,
  confirm,
  reveal,
  onReveal,
  onChange,
  onConfirmChange,
}: {
  value: string
  confirm: string
  reveal: boolean
  onReveal: () => void
  onChange: (value: string) => void
  onConfirmChange: (value: string) => void
}) {
  const strength = passwordScore(value)
  const matches = confirm.length > 0 && value === confirm

  return (
    <div className="ow__secret">
      <span className="ob-label">
        Пароль
        <b aria-hidden="true"> *</b>
      </span>
      <div className="ow__secret-row">
        <input
          className="ob-control"
          type={reveal ? 'text' : 'password'}
          value={value}
          autoComplete="new-password"
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="ow__reveal" onClick={onReveal} tabIndex={-1}>
          {reveal ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      <div className={`ow__strength level-${strength}`} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <input
        className="ob-control"
        type={reveal ? 'text' : 'password'}
        value={confirm}
        placeholder="Повторите пароль"
        autoComplete="new-password"
        onChange={(event) => onConfirmChange(event.target.value)}
      />
      <small className={`ob-hint${confirm.length > 0 ? (matches ? ' is-valid' : ' is-invalid') : ''}`}>
        {confirm.length > 0
          ? matches
            ? 'Пароли совпадают'
            : 'Пароли не совпадают'
          : value
            ? PASSWORD_LABELS[strength]
            : `Минимум ${PASSWORD_MIN_LENGTH} символов. Нужен для входа в систему.`}
      </small>
    </div>
  )
}

/**
 * Пароль владельца — второй секрет, а не повтор первого.
 *
 * Разница между ним и паролем выше — единственное, что человек обязан понять на
 * этом шаге, и подпись под полем говорит именно о ней. Паролем входа
 * пользуется вся смена: логин установки это email владельца, и его же вместе с
 * паролем владелец диктует по телефону, когда кассиру нужно пробить возврат.
 * Пароль владельца не диктуют никому — за ним выручка, себестоимость и
 * сотрудники.
 *
 * Повторного ввода здесь нет намеренно: рядом кнопка «Показать», а пароль этот
 * набирают не каждую смену, в отличие от пароля входа. Второе поле на этом шаге
 * читалось бы как «повторите пароль входа» и провоцировало бы ввести туда его.
 *
 * Своя кнопка «Показать», отдельная от пароля входа: показывать оба секрета
 * одним переключателем значит вывести их на экран рядом при посторонних.
 */
function OwnerPasswordField({
  value,
  accountPassword,
  onChange,
}: {
  value: string
  /** Нужен только чтобы поймать совпадение — оно стирает смысл второго пароля. */
  accountPassword: string
  onChange: (value: string) => void
}) {
  const [reveal, setReveal] = useState(false)
  const short = value.length > 0 && value.length < OWNER_PASSWORD_MIN_LENGTH
  const same = value.length > 0 && value === accountPassword
  const problem = short
    ? `Минимум ${OWNER_PASSWORD_MIN_LENGTH} символов.`
    : same
      ? 'Должен отличаться от пароля входа — иначе второй пароль ничего не закрывает.'
      : ''

  return (
    <div className="ow__secret">
      <span className="ob-label">
        Пароль владельца
        <b aria-hidden="true"> *</b>
      </span>
      <div className="ow__secret-row">
        <input
          className={`ob-control${problem ? ' is-invalid' : ''}`}
          type={reveal ? 'text' : 'password'}
          value={value}
          maxLength={128}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="ow__reveal" onClick={() => setReveal((v) => !v)} tabIndex={-1}>
          {reveal ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      <small className={`ob-hint${problem ? ' is-invalid' : value ? ' is-valid' : ''}`}>
        {problem || `Минимум ${OWNER_PASSWORD_MIN_LENGTH} символов. Отдельно от пароля входа.`}
      </small>
      <p className="ow__pin-note">
        Открывает кабинет владельца: финансы, аналитику, сотрудников. Паролем входа выше кабинет не
        открывается — под ним работает смена. Храните в надёжном месте: восстановить его нельзя,
        касса работает без интернета.
      </p>
    </div>
  )
}

/*
 * Поля PIN здесь больше нет.
 *
 * На шаге регистрации кассиров ещё нет — магазин только заводится, нанимать
 * некого. PIN, заданный в этот момент, к появлению первого кассира знают все,
 * кто стоял рядом при установке. Кассиры и их PIN заводятся в разделе
 * «Сотрудники» скрытых настроек владельца, и PIN у каждого свой: иначе по
 * журналу не сказать, кто именно отменил чек.
 */
