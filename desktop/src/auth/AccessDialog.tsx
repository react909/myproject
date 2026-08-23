/**
 * Окна ввода секрета.
 *
 * Окон два, и это принципиально: своё у владельца и своё у специалиста. Разные
 * заголовки, разные поля, разные маски и свой счётчик попыток на сервере у
 * каждого — ошибка владельца не расходует лимит специалиста и наоборот.
 *
 * Раньше здесь было и третье, общее окно: оно принимало любой из двух секретов
 * и пускало туда, чей подошёл. Удобно, но у него был общий счётчик неудач на
 * оба секрета — пять опечаток владельца закрывали заодно и дверь специалиста,
 * которой человек не касался. Общего окна больше нет; вместе с ним ушёл и
 * переключатель «Владелец / Специалист».
 *
 * Кнопки «Войти» тоже нет. Вход происходит сам, как только введённое похоже на
 * законченный секрет: у ключа известна длина, у пароля — момент, когда человек
 * перестал набирать. Разбор, почему это не транжирит попытки, — у `attempt`.
 *
 * Внутри оба окна собраны из одной формы (`SecretPrompt`): рамка, поле,
 * экранная клавиатура и разбор ошибок у них одинаковые, и две копии этого кода
 * однажды разошлись бы. Разное — заголовок, подпись поля, маска и дверь.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ACCESS_KEYS,
  accessErrorText,
  fetchOwnerPasswordLength,
  isLockedOut,
  isUnlocked,
  liftOwnerLockout,
  subscribeAccess,
  unlockAccess,
  unlockRemainingMs,
} from './accessKeys'
import type { AccessKind } from './accessKeys'
import { AccessKeypad } from './AccessKeypad'
import { SecretDisplay } from './SecretDisplay'
import { expectedLengthFor, readyToSend, settleMsFor, shapeFor, shouldAttempt } from './secretShape'
import type { SecretKind } from './secretShape'
import { useTouchScreen } from '../hooks/useTouchScreen'
import './AccessDialog.css'

/*
 * Правила «когда набранное считается законченным» живут в secretShape.ts —
 * отдельно и без React. От них зависит, войдёт человек или нет, и проверять их
 * надо тестом, а не набирая пароль руками и глядя, сработает ли.
 */

type Props = {
  /** Чья дверь. Одно окно — одна дверь и один счётчик попыток. */
  kind: AccessKind
  /** Зачем открывают дверь — своя строка на каждый вызов. */
  caption?: string
  /** Какая дверь открылась — по ней вызывающий решает, куда вести. */
  onUnlocked: (opened: AccessKind) => void
  onCancel: () => void
}

function SecretPrompt({ kind, caption, onUnlocked, onCancel }: Props) {
  const descriptor = ACCESS_KEYS[kind]
  // Кассирской двери у этих окон нет: они открываются жестами, а PIN кассира
  // спрашивают в другом месте и другой формой.
  const secretKind = kind as SecretKind
  const shape = shapeFor(secretKind)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shift, setShift] = useState(false)
  const [reveal, setReveal] = useState(!descriptor.secret)
  // Своя каретка рисуется поверх поля, а системная скрыта, — значит и знать про
  // фокус надо самим.
  const [focused, setFocused] = useState(true)
  /**
   * Сколько символов в секрете, если сервер это знает.
   *
   * Ради этого числа вход и стал мгновенным: зная длину, окно отправляет пароль
   * ровно на последнем символе — как при вводе кода на телефоне. Ни ожидания
   * паузы, ни проверки на каждую букву (одна проверка на сервере стоит 120 мс и
   * 64 МБ, и именно ими когда-то была занята вся машина).
   *
   * `null` до ответа и на установках, где длина ещё не проставлена, — там окно
   * работает по паузе, как раньше.
   */
  const [ownerLength, setOwnerLength] = useState<number | null>(null)
  /**
   * Дверь закрыта по числу попыток, и мы предлагаем не ждать.
   *
   * Владелец подтверждает паролем от учётной записи, что это он, — и пробует
   * снова сразу. Внутрь этот пароль не пускает и не должен: иначе кассир,
   * знающий пароль от кассы, ошибся бы пять раз нарочно и получил финансы.
   * Снимается только таймер (см. backend `owner/lockout/lift`).
   */
  const [lockedOut, setLockedOut] = useState(false)
  const [liftValue, setLiftValue] = useState('')
  const [liftBusy, setLiftBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const touchScreen = useTouchScreen()

  const expectedLength = expectedLengthFor(secretKind, ownerLength)

  /**
   * Значения, которые уже уходили на проверку, — с любым исходом.
   *
   * Именно с любым, и это исправление настоящей ошибки. Раньше здесь копились
   * только отвергнутые сервером (403), а всё остальное — блокировка двери
   * (429), недоступный сервер, обрыв — в набор не попадало. Значение
   * оставалось «готовым к отправке», проверка запускалась снова, снова падала
   * и снова запускалась: окно уходило в бесконечный цикл запросов и переставало
   * отзываться на нажатия вовсе.
   *
   * Теперь повтор невозможен по построению: то, что уже отправляли, само не
   * отправится. Повторить осознанно можно — ⏎ отправляет и уже пробованное.
   *
   * В ref, а не в состоянии: набор не влияет на то, что нарисовано.
   */
  const attemptedRef = useRef<Set<string>>(new Set())

  /* Последнее набранное — для проверки, к тому ли значению относится ответ.
     Поле больше не запирается на время запроса, значит человек успевает
     дописать, пока ответ в пути, и старая ошибка не должна всплыть над новым
     вводом. */
  const valueRef = useRef(value)
  valueRef.current = value

  /**
   * Обработчики — через ref, и это не стилистика.
   *
   * Вызывающие передают их встроенными стрелками, то есть новыми на каждую
   * отрисовку родителя. Зависела бы от них проверка — таймер ожидания паузы
   * пересоздавался бы на каждый чужой рендер, и пароль, набираемый на экране,
   * где родитель обновляется чаще, чем раз в полсекунды, не уходил бы на
   * проверку никогда. Со стороны это выглядит как намертво зависшее окно,
   * которое «не принимает верный пароль».
   */
  const unlockedRef = useRef(onUnlocked)
  unlockedRef.current = onUnlocked
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    inputRef.current?.focus()
    // Смена двери обнуляет набранное: ключи разные, и дописывать один поверх
    // другого — верный способ отправить чужой секрет не в ту дверь.
    setValue('')
    setError('')
    attemptedRef.current = new Set()
  }, [kind])

  /* Длина пароля владельца — спрашивается один раз при открытии окна.
     У ключа она известна из формата, спрашивать нечего. */
  useEffect(() => {
    if (secretKind !== 'owner') return undefined
    let cancelled = false
    void fetchOwnerPasswordLength().then((length) => {
      if (!cancelled) setOwnerLength(length)
    })
    return () => {
      cancelled = true
    }
  }, [secretKind])

  const attempt = useCallback(
    async (candidate: string) => {
      // Запоминаем до отправки, а не после: иначе следующая отрисовка успевает
      // увидеть значение «ещё не пробованным» и запускает вторую проверку того
      // же самого.
      attemptedRef.current.add(candidate)
      setBusy(true)
      setError('')
      try {
        // Одна проверка на окно: секрет уходит в ту дверь, ради которой окно и
        // открыли. Так одна опечатка засчитывается один раз и только своему
        // счётчику — соседняя дверь о ней не узнаёт.
        await unlockAccess(kind, candidate)
        unlockedRef.current(kind)
      } catch (caught) {
        // Ответ мог опоздать: поле не запирается, и человек успел дописать.
        // Ошибка про прошлое значение над новым вводом только сбивает с толку.
        if (valueRef.current.trim() !== candidate) return
        // Дверь закрылась по числу попыток — предлагаем не ждать, а
        // подтвердить паролем входа. Только у владельца: у специалиста пароля
        // учётной записи нет, он приходит с ключом установки.
        if (isLockedOut(caught) && secretKind === 'owner') setLockedOut(true)
        setError(accessErrorText(caught))
        // Набранное намеренно остаётся на месте. Стирать поле рывком на ошибке
        // значит заставлять набирать двадцать символов ключа заново из-за
        // одного промаха — и лишить человека возможности увидеть, где он
        // ошибся, сверив набранное с наклейкой.
        inputRef.current?.focus()
      } finally {
        setBusy(false)
      }
    },
    [kind],
  )

  /** Отправка по явному действию: ⏎ на клавиатуре или Enter на физической.
   *
   *  Отличается от автоматической ровно одним: отправляет и то, что уже
   *  пробовали. Автоматическая этого не делает и не должна — иначе вернётся
   *  цикл повторов; но человек, нажавший ⏎ второй раз, просит повторить
   *  осознанно, и отказывать ему нечем (сервер мог быть недоступен). */
  /**
   * Снять блокировку паролем учётной записи.
   *
   * Внутрь не пускает: после успеха окно возвращается к вводу пароля владельца,
   * просто без ожидания. Набранное до блокировки очищается — оно всё равно не
   * подошло, и дописывать поверх него незачем.
   */
  const lift = useCallback(async () => {
    const candidate = liftValue.trim()
    if (liftBusy || !candidate) return
    setLiftBusy(true)
    try {
      await liftOwnerLockout(candidate)
      setLockedOut(false)
      setLiftValue('')
      setError('')
      setValue('')
      // Прошлые попытки больше не в счёт — иначе верный пароль, набранный
      // до блокировки, второй раз не отправился бы.
      attemptedRef.current = new Set()
      inputRef.current?.focus()
    } catch (caught) {
      setError(accessErrorText(caught))
    } finally {
      setLiftBusy(false)
    }
  }, [liftValue, liftBusy])

  const submitNow = useCallback(() => {
    if (busy) return
    const candidate = value.trim()
    if (!candidate || !readyToSend(secretKind, candidate, expectedLength)) return
    void attempt(candidate)
  }, [busy, value, secretKind, expectedLength, attempt])

  /**
   * Ждёт ли окно проверки прямо сейчас.
   *
   * Считается и при отрисовке, и в эффекте — одной и той же функцией, чтобы
   * индикатор не мог разойтись с тем, что произойдёт на самом деле. Это и есть
   * ответ на «я всё набрал, а оно не заходит»: как только набранного хватает,
   * загорается индикатор, и видно, что проверка уже идёт, а не что окно
   * замерло.
   */
  const pending = shouldAttempt(secretKind, value, attemptedRef.current, busy, expectedLength)

  /*
   * Автоматический вход. Кнопки нет: как только введённое похоже на
   * законченный секрет и человек перестал набирать — оно уходит на проверку.
   *
   * Таймер пересоздаётся на каждую правку, поэтому во время набора он не
   * срабатывает ни разу: считается пауза после последнего символа, а не время
   * с начала ввода.
   */
  useEffect(() => {
    if (!pending) return undefined
    const candidate = value.trim()
    const settleMs = settleMsFor(secretKind, expectedLength)
    const timer = window.setTimeout(() => void attempt(candidate), settleMs)
    return () => window.clearTimeout(timer)
  }, [pending, value, secretKind, expectedLength, attempt])

  const type = useCallback(
    (raw: string) => {
      setValue(shape.mask(raw))
      // Прежняя ошибка снимается при первой же правке: она относилась к тому,
      // что было набрано, и висеть над новым вводом ей незачем.
      setError('')
    },
    [shape],
  )

  /* Ввод с экранной клавиатуры идёт в то же состояние, что и с физической:
     двух источников истины для одного поля быть не должно. */
  const typeCharacter = (character: string) => {
    setValue((prev) => shape.mask(prev + character))
    setError('')
    // Залипание снимается после первого символа, как на телефоне: ключ целиком
    // заглавными набирают редко, а Caps Lock тут негде увидеть.
    setShift(false)
    inputRef.current?.focus()
  }

  const inputType = useMemo(
    () => (descriptor.secret && !reveal ? 'password' : 'text'),
    [descriptor.secret, reveal],
  )

  // Закрытие по Esc: на моноблоке его нет, но там есть кнопка «Отмена» и касание
  // мимо окна. За ноутбуком Esc — первое, что нажимают, чтобы уйти.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="acc-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={descriptor.title}
      // Своя клавиатура уже в окне — общая плавающая здесь только мешала бы.
      data-no-virtual-keyboard
      onPointerDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <form
        // Шире, когда внутри клавиатура: в русском ряду одиннадцать клавиш, а в
        // нижнем — двенадцать позиций вместе с ⇧ и ⌫. При минимальных для
        // пальца 44 px они в прежние 560 px не помещались, и ряд уезжал за
        // край вместе с полосой прокрутки под окном.
        className={`acc-panel acc-panel--${kind}${touchScreen ? ' acc-panel--touch' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          // Enter — не кнопка «Войти», а способ не ждать паузу: проверка и так
          // произойдёт сама, здесь человек лишь сообщает, что уже дописал.
          submitNow()
        }}
      >
        <header className="acc-head">
          <h2 className="acc-title">{descriptor.title}</h2>
          {caption && <p className="acc-caption">{caption}</p>}
        </header>

        <label className="acc-field">
          <span className="acc-label">{descriptor.fieldLabel}</span>
          <div
            className={`acc-entry${error ? ' is-invalid' : ''}${focused ? ' is-focused' : ''}${
              shape.mono ? ' acc-entry--key' : ''
            }`}
          >
            {/*
              Настоящее поле — поверх ячеек и прозрачное. Так физическая
              клавиатура, выделение и системные жесты работают как всегда, а
              видно при этом ячейки с движением. Подменять поле своим
              состоянием нельзя: на установке с обычной клавиатурой это сломало
              бы привычный ввод ради красоты на моноблоке.
            */}
            <input
              ref={inputRef}
              className="acc-entry__input"
              type={inputType}
              inputMode={descriptor.inputMode}
              value={value}
              maxLength={shape.maxLength}
              autoComplete="off"
              spellCheck={false}
              /*
                Поле не запирается на время проверки — ни `disabled`, ни
                `readOnly`.

                Это была настоящая ошибка, а не мелочь. Проверка запускалась
                часто, поле на её время становилось `readOnly`, и набор
                переставал приниматься: со стороны выглядело так, будто клавиши
                «Показать» и «Отмена» не нажимаются и всё зависло. Запаздывающий
                ответ теперь просто отбрасывается, если человек успел дописать.
              */
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(event) => type(event.target.value)}
            />

            <SecretDisplay
              value={value}
              reveal={reveal}
              placeholder={shape.placeholder}
              focused={focused && !busy}
              // Волна по набранному, пока идёт проверка: движение там, куда
              // человек в этот момент смотрит.
              busy={busy}
              // Не подошло — кружки мотает «нет», туда же, куда направлен взгляд.
              invalid={!!error}
            />

            {/* Индикатор проверки живёт поверх поля, а не рядом: в потоке он
                сдвигал бы всё, что ниже, на каждой попытке. Загорается уже на
                ожидании, а не только на запросе, — иначе пауза перед проверкой
                выглядит как «окно не реагирует». */}
            <span className={`acc-spinner${pending || busy ? ' is-on' : ''}`} aria-hidden="true" />
          </div>
        </label>

        {/*
          Место под сообщение зарезервировано всегда. Появление ошибки не должно
          сдвигать ни поле, ни клавиатуру под ним: на сенсорном экране палец уже
          занесён над клавишей, и прыжок вёрстки означает промах.
        */}
        <div className="acc-status" role="status" aria-live="polite">
          {error ? (
            <p className="acc-error">{error}</p>
          ) : (
            /* Во время проверки по подписи проходит светлая полоса — то же
               «идёт работа», что и волна по кружкам, только здесь она читается
               как загрузка текста, а не как мигание. */
            <p className={`acc-difference${busy || pending ? ' is-checking' : ''}`}>
              {descriptor.difference}
            </p>
          )}
        </div>

        {/*
          Дверь закрыта по числу попыток — предлагаем не ждать.

          Поле здесь второе и другое: это пароль учётной записи, тот самый,
          которым входят в кассу. Он подтверждает, что за клавиатурой владелец,
          и снимает таймер — но кабинет по-прежнему открывает только пароль
          владельца выше. Подпись говорит об этом прямо, чтобы никто не решил,
          что нашёл обходной путь.
        */}
        {lockedOut && (
          <div className="acc-lift">
            <p className="acc-lift__note">
              Не ждать: подтвердите паролем входа, что это вы. Кабинет он не откроет — только
              снимет блокировку, и пароль владельца можно будет ввести снова.
            </p>
            <div className="acc-lift__row">
              <input
                className="acc-lift__input"
                type="password"
                value={liftValue}
                placeholder="Пароль входа в систему"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setLiftValue(event.target.value)}
              />
              <button
                type="button"
                className="acc-lift__btn"
                disabled={liftBusy || !liftValue.trim()}
                onClick={() => void lift()}
              >
                {liftBusy ? 'Проверяем…' : 'Снять'}
              </button>
            </div>
          </div>
        )}

        {/*
          Экранная клавиатура — только на сенсорных установках.
          На моноблоке без физической клавиатуры она единственный способ набрать
          ключ; там, где клавиатура есть, панель на пол-окна только мешает.
          Признак задаёт специалист на первом шаге мастера.
        */}
        {touchScreen && (
          <AccessKeypad
            shift={shift}
            onShiftChange={setShift}
            onKey={typeCharacter}
            onBackspace={() => setValue((prev) => shape.mask(prev.slice(0, -1)))}
            onClear={() => {
              setValue('')
              setError('')
            }}
            reveal={reveal}
            onRevealChange={setReveal}
            revealable={descriptor.secret}
            onCancel={onCancel}
            onSubmit={submitNow}
            canSubmit={readyToSend(secretKind, value.trim(), expectedLength)}
            busy={busy}
            // Ключ — латиница и цифры, маска выбрасывает всё остальное. С
            // русской раскладки его было не набрать вовсе: поле оставалось
            // пустым, сколько ни жми.
            initialLayout={secretKind === 'specialist' ? 'english' : 'russian'}
          />
        )}

        {!touchScreen && (
          <div className="acc-foot">
            <button type="button" className="acc-close" onClick={onCancel}>
              Отмена
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

/**
 * Окно владельца. Открывается аккордом `Ctrl+Shift+M`.
 *
 * За ним деньги: аналитика, финансы, сотрудники. Вводится пароль владельца —
 * отдельный секрет, заданный на шаге «Учётная запись» при установке. Пароль,
 * которым владелец входит в систему, сюда не подходит: под учётной записью
 * владельца работает вся смена.
 */
export function OwnerAccessDialog(props: Omit<Props, 'kind'>) {
  return (
    <SecretPrompt
      kind="owner"
      caption={props.caption ?? 'Аналитика, финансы и сотрудники.'}
      onUnlocked={props.onUnlocked}
      onCancel={props.onCancel}
    />
  )
}

/**
 * Окно специалиста. Открывается цепочкой жестов — см. hiddenAccessGate.
 *
 * За ним мастер настройки: оборудование, оформление, чек. Вводится
 * лицензионный ключ установки вида KASSIR-XXXX-XXXX-XXXX — тот же, что вводили
 * при первом запуске, и тот, с которым специалист приезжает.
 */
export function SpecialistAccessDialog(props: Omit<Props, 'kind'>) {
  return (
    <SecretPrompt
      kind="specialist"
      caption={props.caption ?? 'Возврат в мастер настройки: оборудование, оформление, чек.'}
      onUnlocked={props.onUnlocked}
      onCancel={props.onCancel}
    />
  )
}

/** Открыта ли дверь сейчас; пересчитывается по событию и по истечении срока. */
export function useAccessUnlocked(kind: AccessKind): boolean {
  const [unlocked, setUnlocked] = useState(() => isUnlocked(kind))

  useEffect(() => {
    const sync = () => setUnlocked(isUnlocked(kind))
    const stop = subscribeAccess(sync)
    // Доступ истекает молча, без события, — поэтому ещё и таймер. Он ставится
    // ровно на момент истечения, а не тикает каждую секунду впустую.
    const remaining = unlockRemainingMs(kind)
    const timer = remaining > 0 ? window.setTimeout(sync, remaining + 250) : undefined
    return () => {
      stop()
      if (timer) window.clearTimeout(timer)
    }
  }, [kind, unlocked])

  return unlocked
}

/**
 * Показывает содержимое только после ввода нужного ключа.
 *
 * Пока дверь закрыта, дочерние компоненты не монтируются вовсе — так они не
 * успевают запросить у сервера ни выручку, ни себестоимость. Права при этом
 * проверяет сервер, а не эта обёртка: она решает, что рисовать, и не более —
 * прямой запрос к защищённому маршруту без повышенной сессии сервер отвергнет
 * сам (см. backend/app/core/access.py).
 */
export function AccessGate({
  kind,
  caption,
  onCancel,
  children,
}: {
  kind: AccessKind
  caption?: string
  onCancel?: () => void
  children: ReactNode
}) {
  const unlocked = useAccessUnlocked(kind)
  if (unlocked) return <>{children}</>
  return (
    <SecretPrompt
      kind={kind}
      caption={caption}
      onUnlocked={() => undefined}
      onCancel={() => (onCancel ? onCancel() : window.history.back())}
    />
  )
}
