/**
 * Открытие скрытых настроек.
 *
 * Двери две, и открываются они по-разному.
 *
 * Владелец — аккордом `Ctrl+Shift+M`. Одно действие, сразу окно ввода пароля:
 * владелец заходит к своим финансам часто, и прятать этот вход глубже незачем.
 *
 * Специалист — цепочкой из трёх действий, и это главное отличие:
 *
 *   1. аккорд `Ctrl+Alt+Shift` + обе стрелки — тихое разрешение на полминуты;
 *   2. пять быстрых тапов по логотипу — пока разрешение действует;
 *   3. удержание логотипа пять секунд — открывает окно ключа.
 *
 * Каждое звено работает только после предыдущего, и ни одно не даёт видимой
 * реакции до самого конца. Правила про время живут отдельно, без React, — см.
 * hiddenAccessGate.
 *
 * Зачем так. Один только жест на логотипе рано или поздно находит любопытный
 * кассир: логотип на виду, а удержание — первое, что пробуют на сенсорном
 * экране. Один только аккорд легко нажать случайно и, что важнее, подсмотреть
 * из-за плеча. Три разнородных действия подряд не воспроизводятся ни случайно,
 * ни подглядыванием.
 *
 * Ценой этого сервисный режим недоступен на моноблоке без физической
 * клавиатуры: начать цепочку там нечем. Тапы по логотипу эту цену не отменяют —
 * они звено цепочки, а не обход её первого шага. Это осознанное решение
 * владельца продукта, а не упущение.
 *
 * Аккорды слушаются, пока окно приложения в фокусе, — по всему приложению, а не
 * только когда курсор в шапке. Регистрировать их глобально на всю систему
 * нельзя: касса не имеет права перехватывать клавиши у чужих программ.
 * Аккорд вида «Ctrl+Alt+L+I» технически невозможен — клавиатура не передаёт две
 * обычные буквенные клавиши в одном сочетании; стрелки передаёт, на них аккорд
 * специалиста и построен. `Ctrl+Esc` не годится по другой причине: его забирает
 * себе Windows, и до приложения он не доходит.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings } from '../settings/appSettings'
import {
  DEFAULT_HIDDEN_ACCESS,
  matchesShortcut,
  matchesSpecialistChordWithin,
} from './hiddenAccess'
import {
  ARM_WINDOW_MS,
  HOLD_WINDOW_MS,
  arm,
  completeTaps,
  createGateState,
  disarm as disarmGate,
  isArmed as gateIsArmed,
  registerTap,
  shouldStartHold,
  tapsArm,
} from './hiddenAccessGate'
import type { GateState } from './hiddenAccessGate'
import type { AccessKind } from './accessKeys'

export type HiddenAccessTarget = Extract<AccessKind, 'owner' | 'specialist'>

/**
 * Чьё окно сейчас открыто.
 *
 * Окна два, и каждое знает свою дверь заранее. Общего окна «введите что
 * есть» больше нет: у него был один счётчик неудач на оба секрета, и опечатки
 * владельца закрывали дверь специалиста.
 */
export type PendingDoor = HiddenAccessTarget

export { ARM_WINDOW_MS }

export type HiddenAccessState = {
  /** Чьё окно сейчас открыто. `null` — окна нет. */
  pending: PendingDoor | null
  clear: () => void
  /**
   * Оба жеста на логотипе: и серия тапов (второе звено), и удержание (третье).
   *
   * Раньше тапы висели на часах, а удержание на знаке — жест был разнесён по
   * двум углам шапки, и объяснять его по телефону приходилось дважды. Логотип
   * при этом не кнопка: случайно по нему не попадают, а пять быстрых тапов по
   * нему без взведённого аккорда не значат ровно ничего.
   */
  longPressHandlers: {
    onPointerDown: () => void
    onPointerUp: () => void
    onPointerLeave: () => void
    onContextMenu: (event: { preventDefault: () => void }) => void
  }
  /**
   * 0…1 — сколько уже удерживают. Ноль, пока цепочка не пройдена до третьего
   * звена: без неё жеста не существует, и показывать нечего.
   */
  longPressProgress: number
  /** Сколько всего надо держать, в миллисекундах. */
  longPressMs: number
}

export function useHiddenAccess(): HiddenAccessState {
  const [pending, setPending] = useState<PendingDoor | null>(null)
  const [longPressProgress, setProgress] = useState(0)
  const [longPressMs, setLongPressMs] = useState(DEFAULT_HIDDEN_ACCESS.longPressMs)
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  /**
   * До какого момента взведено ожидание жеста.
   *
   * В ref, а не в состоянии: взведённое ожидание не должно приводить к
   * перерисовке. Любая перерисовка — это шанс, что оно как-нибудь проступит
   * наружу, а его не должно быть видно нигде: ни в интерфейсе, ни в заголовке
   * окна.
   */
  const gateRef = useRef<GateState>(createGateState())
  const armTimerRef = useRef<number | null>(null)
  /** Метки тапов по часам. Тоже в ref: серия не должна перерисовывать шапку. */
  const tapsRef = useRef<number[]>([])

  const disarm = useCallback(() => {
    gateRef.current = disarmGate()
    if (armTimerRef.current) window.clearTimeout(armTimerRef.current)
    armTimerRef.current = null
  }, [])

  /** Можно ли начинать удержание — то есть отработали ли аккорд и тапы. */
  const canHold = useCallback(() => shouldStartHold(gateRef.current, Date.now()), [])

  /** Первое звено: аккорд выдаёт разрешение. Видимой реакции нет. */
  const armGate = useCallback(() => {
    gateRef.current = arm(gateRef.current, Date.now())
    tapsRef.current = []
    if (armTimerRef.current) window.clearTimeout(armTimerRef.current)
    armTimerRef.current = window.setTimeout(disarm, ARM_WINDOW_MS)
  }, [disarm])

  /**
   * Второе звено: тап по логотипу.
   *
   * Без действующего разрешения тап не считается вовсе — не откладывается даже
   * метка. Пять тапов подряд без аккорда не приближают к сервисному режиму ни
   * на шаг, и узнать об этом по поведению приложения нельзя: видимой реакции
   * нет ни на одном тапе, ни на пятом.
   */
  const onLogoTap = useCallback(() => {
    const now = Date.now()
    if (!gateIsArmed(gateRef.current, now)) return
    tapsRef.current = registerTap(tapsRef.current, now)
    if (!tapsArm(tapsRef.current)) return
    tapsRef.current = []
    // Серия набрана: разрешение тратится, взамен появляется право на удержание
    // со своим окном.
    gateRef.current = completeTaps(gateRef.current, now)
    if (armTimerRef.current) window.clearTimeout(armTimerRef.current)
    armTimerRef.current = window.setTimeout(disarm, HOLD_WINDOW_MS)
  }, [disarm])

  useEffect(() => {
    /* Когда каждая стрелка нажималась последний раз.
       Не набор «зажато прямо сейчас», а именно время: требовать от человека
       удерживать обе стрелки одновременно оказалось слишком строго — с зажатыми
       тремя модификаторами их жмут по очереди, и первую успевают отпустить.
       Разбор — у matchesSpecialistChordWithin. */
    const pressedAt = new Map<string, number>()

    const onKey = (event: KeyboardEvent) => {
      // Автоповтор отметку обновляет, но дальше не идёт: зажатая стрелка иначе
      // взводила бы ожидание по десятку раз в секунду.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        pressedAt.set(event.key, Date.now())
      }
      if (event.repeat) return
      const config = { ...DEFAULT_HIDDEN_ACCESS, ...loadSettings().hiddenAccess }

      // Владелец — сразу окно ввода пароля.
      if (matchesShortcut(event, config.owner)) {
        event.preventDefault()
        disarm()
        setPending('owner')
        return
      }

      // Специалист — только взвод ожидания. Видимой реакции нет намеренно:
      // человек за спиной не должен понять, что вообще что-то произошло.
      if (matchesSpecialistChordWithin(event, pressedAt, Date.now())) {
        event.preventDefault()
        // Отметки гасятся: иначе следующая же стрелка в пределах окна взводила
        // бы ожидание заново, и одного нажатия хватало бы на второй заход.
        pressedAt.clear()
        armGate()
      }
    }

    /* Уход фокуса с окна очищает отметки: продолжать набирать аккорд после
       переключения на другую программу человек не может, а «недобранная»
       половина не должна ждать его возвращения. */
    const onBlur = () => pressedAt.clear()

    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [armGate, disarm])

  const stopPress = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    timerRef.current = null
    rafRef.current = null
    setProgress(0)
  }, [])

  const startPress = useCallback(() => {
    stopPress()
    // Третье звено. Права на удержание нет — жеста не существует: ни таймера,
    // ни отсчёта. Кассир, зажавший логотип из любопытства, не увидит ровно
    // ничего, сколько бы ни держал.
    if (!canHold()) return

    const config = { ...DEFAULT_HIDDEN_ACCESS, ...loadSettings().hiddenAccess }
    setLongPressMs(config.longPressMs)
    const started = Date.now()

    /* Прогресс считается от часов, а не от числа кадров: при просадке
       отрисовки индикация иначе отставала бы от таймера, и человек отпускал бы
       логотип за мгновение до срабатывания. */
    const tick = () => {
      const ratio = Math.min(1, (Date.now() - started) / config.longPressMs)
      setProgress(ratio)
      if (ratio < 1) rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)

    timerRef.current = window.setTimeout(() => {
      stopPress()
      // Цепочка одноразовая: открылось окно — все права погасли. Иначе одного
      // прохода хватило бы на несколько заходов подряд.
      disarm()
      // Цепочка жестов — путь специалиста, и окно у неё своё. У владельца свой
      // аккорд и своё окно; общего окна на обоих больше нет.
      setPending('specialist')
    }, config.longPressMs)
  }, [canHold, disarm, stopPress])

  // Таймеры и кадр обязаны сняться при размонтировании: иначе окно ключа
  // всплывёт на уже закрытом экране, а взвод переживёт уход с него.
  useEffect(
    () => () => {
      stopPress()
      disarm()
    },
    [disarm, stopPress],
  )

  /**
   * Оба жеста на логотипе живут на одном pointerdown, и порядок здесь важен.
   *
   * Сначала засчитывается тап: именно он на пятом нажатии выдаёт право на
   * удержание. Только после этого проверяется, начинать ли отсчёт, — иначе
   * пятый тап пришлось бы отпустить и нажать шестой раз, чтобы удержание
   * вообще началось.
   *
   * Обратный порядок ничего бы не сломал по правам (звенья проверяются по
   * времени, а не по счётчику вызовов), но добавил бы человеку лишнее нажатие
   * ровно там, где он уже сделал всё правильно.
   */
  const onLogoPointerDown = useCallback(() => {
    onLogoTap()
    startPress()
  }, [onLogoTap, startPress])

  return {
    pending,
    clear: () => {
      // Закрыли окно — взвод тоже гаснет: следующий заход начинается с аккорда.
      disarm()
      setPending(null)
    },
    /**
     * Тапы и удержание — на логотипе, оба звена на одном месте.
     *
     * По pointerdown, а не по клику: на сенсорном экране клик приходит с
     * задержкой распознавания двойного тапа, и быстрая серия из пяти в неё не
     * укладывалась бы.
     */
    longPressHandlers: {
      onPointerDown: onLogoPointerDown,
      onPointerUp: stopPress,
      onPointerLeave: stopPress,
      // Долгое нажатие на сенсорном экране вызывает контекстное меню — оно
      // перебило бы удержание на середине отсчёта.
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    },
    longPressProgress,
    longPressMs,
  }
}
