/**
 * Реквизиты магазина в настройках.
 *
 * Единственное место, где реквизиты правят после установки. Форма собирается
 * из того же реестра полей, что и мастер первого запуска, поэтому копий полей
 * здесь нет — добавили поле в fields.ts, оно появилось на обоих экранах.
 *
 * Режим работы меняется здесь же: переустановка ради перехода на фискальную
 * кассу (или обратно) не нужна. Набор полей и состав чека переключаются сами —
 * их определяет реестр, а не этот экран.
 */

import { useEffect, useMemo, useState } from 'react'
import { AnalyticsModePicker } from '../../onboarding/AnalyticsModePicker'
import { LogoStudio } from '../../onboarding/LogoStudio'
import {
  AccentPicker,
  BrandModePicker,
  AppHeaderEditor,
  ReceiptLogoEditor,
  rebuildLogoVariants,
} from '../../onboarding/BrandEditor'
import { OnboardingSection } from '../../onboarding/OnboardingForm'
import { FiscalModePicker } from '../../onboarding/FiscalModePicker'
import { KkmInfoBlock } from '../../onboarding/KkmInfoBlock'
import { OutletGeoPicker } from '../../onboarding/OutletGeoPicker'
import { PaymentProvidersEditor } from '../../onboarding/PaymentProvidersEditor'
import { ReceiptPreview } from '../../onboarding/ReceiptPreview'
import { TaxNote } from '../../onboarding/TaxNote'
import { FIELDS, fieldApplies, groupBySection, validateField } from '../../onboarding/fields'
import type { FieldDef } from '../../onboarding/fields'
import { onboardingErrorText, saveOnboarding } from '../../onboarding/storage'
import { useOnboarding } from '../../onboarding/useOnboarding'
import { PAYMENT_METHODS, applyFiscalMode } from '../../onboarding/types'
import type {
  BrandingData,
  FiscalMode,
  KkmData,
  OnboardingData,
  OutletData,
  PaymentMethodId,
} from '../../onboarding/types'
import { SettingsHelpFooter } from '../SettingsHelpFooter'
import './RequisitesSection.css'

/**
 * Секреты и сфера меняются не здесь: пароль и PIN — в разделе безопасности,
 * сфера задаёт схему каталога и её смена на ходу ломает уже заведённые товары.
 * Превью чека тоже исключено — оно и так стоит справа во всю высоту.
 */
const HIDDEN_FIELDS = new Set([
  'owner.email',
  'owner.password',
  'owner.pin',
  'business.industry',
  'branding.receiptPreview',
])

export function RequisitesSection() {
  const stored = useOnboarding()
  const [draft, setDraft] = useState<OnboardingData>(stored)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [kkmLocked, setKkmLocked] = useState(false)

  // Подтягиваем свежие данные, пока их не начали править: перетирать набранное
  // фоновым ответом сервера нельзя.
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched) setDraft(stored)
  }, [stored, touched])

  const sections = useMemo(
    () =>
      groupBySection(
        FIELDS.filter(
          (field) =>
            !HIDDEN_FIELDS.has(field.id) &&
            field.id !== 'branding.theme' &&
            fieldApplies(field, draft),
        ),
      ),
    // Видимость зависит не только от режима: единый налог появляется вместе с
    // упрощённой системой, поэтому пересобираем секции на любую правку.
    [draft],
  )

  const problems = useMemo(
    () =>
      FIELDS.filter((field) => !HIDDEN_FIELDS.has(field.id)).filter((field) =>
        validateField(field, draft),
      ),
    [draft],
  )

  /**
   * Правка черновика реквизитов.
   *
   * Только функцией от предыдущего значения. Готовый объект, собранный из
   * `draft` во время отрисовки, теряет соседнюю правку, если обе попали в один
   * кадр: обе прочитали одно и то же состояние, и вторая затёрла первую. На
   * форме с двумя десятками полей это ловится не сразу — «поле не сохранилось»
   * выглядит как случайность.
   */
  const update = (change: (previous: OnboardingData) => OnboardingData) => {
    setTouched(true)
    setSaved(false)
    setDraft(change)
  }

  const patchBranding = (patch: Partial<BrandingData>) => {
    update((prev) => ({ ...prev, branding: { ...prev.branding, ...patch } }))
  }

  /* Настройки подписи меняются здесь так же, как в мастере, поэтому и
     композиция с четырьмя файлами пересобирается тем же кодом. */
  useEffect(() => {
    const { branding } = draft
    if (branding.useFactoryBrand || !branding.logoMark) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      void rebuildLogoVariants(branding)
        .then((patch) => {
          if (cancelled || !patch.logoVariants) return
          setDraft((prev) => ({ ...prev, branding: { ...prev.branding, ...patch } }))
        })
        .catch(() => undefined)
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // logo здесь намеренно нет: он и есть результат пересборки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.branding.logoMark, draft.branding.useFactoryBrand])

  const patchOutlet = (patch: Partial<OutletData>) => {
    update((prev) => ({ ...prev, outlet: { ...prev.outlet, ...patch } }))
  }

  const patchKkm = (patch: Partial<KkmData>) => {
    update((prev) => ({ ...prev, kkm: { ...prev.kkm, ...patch } }))
  }

  const setFiscalMode = (fiscalMode: FiscalMode) => {
    setError('')
    update((prev) => applyFiscalMode(prev, fiscalMode))
  }

  const save = async () => {
    if (problems.length) {
      setError(`Не заполнено полей: ${problems.length}. Без них чек напечатать нельзя.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveOnboarding(draft)
      setTouched(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (caught) {
      setError(onboardingErrorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const renderCustom = (field: FieldDef) => {
    switch (field.id) {
      case 'fiscalMode':
        return (
          <div className="rq-mode">
            <FiscalModePicker value={draft.fiscalMode} onChange={setFiscalMode} />
            <p className="rq-mode__note">
              {draft.fiscalMode === 'fiscal'
                ? 'Фискальный режим требует ИНН, СНО, координат и реквизитов ККМ — без них чек не сохранится.'
                : 'В простом режиме печатается товарный чек: фискальные строки и QR ГНС в него не попадают. Реквизиты кассы сохранятся и вернутся, если переключить режим обратно.'}
            </p>
          </div>
        )
      case 'outlet.coords':
        return <OutletGeoPicker data={draft} onChange={patchOutlet} error={validateField(field, draft)} />
      case 'tax.note':
        return <TaxNote data={draft} />
      case 'acquiring.providers':
        // Здесь сервер уже поднят и авторизован — мерчант-ключ можно задать.
        return (
          <PaymentProvidersEditor
            value={draft.acquiring.providers}
            onChange={(providers) =>
              update((prev) => ({
                ...prev,
                acquiring: { ...prev.acquiring, providers: providers(prev.acquiring.providers) },
              }))
            }
          />
        )
      case 'kkm.reader':
        return (
          <KkmInfoBlock
            kkm={draft.kkm}
            onChange={patchKkm}
            locked={kkmLocked}
            onLockedChange={setKkmLocked}
          />
        )
      case 'acquiring.methods':
        return (
          <div className="rq-methods">
            {PAYMENT_METHODS.map((method) => {
              const checked = draft.acquiring.methods.includes(method.id)
              const locked = method.id === 'cash'
              return (
                <label key={method.id} className={`rq-method${checked ? ' is-checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() =>
                      update((prev) => ({
                        ...prev,
                        acquiring: {
                          ...prev.acquiring,
                          methods: prev.acquiring.methods.includes(method.id as PaymentMethodId)
                            ? prev.acquiring.methods.filter((item) => item !== method.id)
                            : [...prev.acquiring.methods, method.id as PaymentMethodId],
                        },
                      }))
                    }
                  />
                  <span>{method.label}</span>
                </label>
              )
            })}
          </div>
        )
      // Режим аналитики меняется здесь же: это представление, а не схема
      // учёта, и переключать его можно в любой момент без пересчёта данных.
      case 'business.analyticsMode':
        return (
          <AnalyticsModePicker
            value={draft.business.analyticsMode}
            onChange={(analyticsMode) =>
              update((prev) => ({ ...prev, business: { ...prev.business, analyticsMode } }))
            }
          />
        )
      case 'branding.factoryBrand':
        return (
          <BrandModePicker
            value={draft.branding.useFactoryBrand}
            onChange={(useFactoryBrand) => patchBranding({ useFactoryBrand })}
          />
        )
      case 'branding.logo':
        return (
          <LogoStudio
            branding={draft.branding}
            suggestedName={draft.company.shortName || draft.outlet.name}
            onChange={patchBranding}
            onError={setError}
          />
        )
      case 'branding.logoTextEditor':
        return (
          <AppHeaderEditor
            branding={draft.branding}
            onChange={patchBranding}
            onError={setError}
          />
        )
      case 'branding.primaryColor':
        return (
          <AccentPicker
            value={draft.branding.primaryColor}
            mode={draft.branding.theme}
            branding={draft.branding}
            onChange={(primaryColor) => patchBranding({ primaryColor })}
          />
        )
      case 'branding.receiptLook':
        return (
          <ReceiptLogoEditor branding={draft.branding} onChange={patchBranding} onError={setError} />
        )
      case 'branding.theme':
        // Тема переключается в разделе «Экран» — дублировать её здесь незачем.
        return null
      default:
        return null
    }
  }

  return (
    <section className="settings-section rq">
      <h2 className="settings-section__title">Реквизиты</h2>
      <p className="settings-section__desc">
        Эти данные печатаются в каждом чеке. Справа — как чек будет выглядеть на ленте.
      </p>

      <div className="rq__layout">
        <div className="rq__form">
          {sections.map(({ section, fields }) => (
            <OnboardingSection
              key={section}
              section={section}
              fields={fields}
              data={draft}
              onChange={update}
              showErrors
              renderCustom={renderCustom}
              lockedFieldIds={
                kkmLocked
                  ? new Set(['kkm.serialNumber', 'kkm.registrationNumber', 'kkm.fiscalModule'])
                  : undefined
              }
            />
          ))}

          <div className="rq__actions">
            <button type="button" className="rq__save" onClick={() => void save()} disabled={busy || !touched}>
              {busy ? 'Сохранение…' : saved ? 'Сохранено' : 'Сохранить реквизиты'}
            </button>
            {error && <p className="rq__error">{error}</p>}
            {!error && problems.length > 0 && (
              <p className="rq__warn">Не заполнено полей: {problems.length}</p>
            )}
          </div>
        </div>

        <aside className="rq__preview">
          <ReceiptPreview data={draft} />
        </aside>
      </div>

      <SettingsHelpFooter>
        <p>
          Реквизиты хранятся в локальной базе и уходят в чек напрямую. Отдельных копий этих полей в других разделах
          больше нет — меняются здесь, применяются везде. Режим работы переключается тут же: переустанавливать
          программу ради перехода на фискальную кассу не нужно.
        </p>
      </SettingsHelpFooter>
    </section>
  )
}
