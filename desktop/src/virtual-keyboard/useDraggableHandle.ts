/**
 * Кнопка, которую можно перетащить куда угодно и которая это запоминает.
 *
 * Зачем. Кнопка вызова клавиатуры висит поверх рабочего экрана кассы, и в любом
 * углу она что-нибудь закрывает: в левом нижнем — итог смены, в правом — кнопку
 * оплаты. Какой угол свободен, зависит от магазина и от разрешения монитора, и
 * угадать его за клиента нельзя. Поэтому место выбирает тот, кто за кассой
 * стоит, и выбирает один раз.
 *
 * Главная сложность — отличить перенос от нажатия: кнопка обязана и открывать
 * клавиатуру, и таскаться, причём пальцем, который никогда не стоит на месте
 * ровно. Отсюда порог: пока палец не ушёл дальше `DRAG_THRESHOLD_PX`, это
 * нажатие, дальше — перенос, и нажатие уже не сработает.
 *
 * Положение хранится в localStorage, а не в настройках на сервере: это привычка
 * конкретного рабочего места, а не настройка  магазина, и синхронизировать её
 * между устройствами не нужно.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { loadSettings } from '../settings/appSettings'

export type HandlePosition = { x: number; y: number }

const STORAGE_KEY = 'nurcrm-keyboard-handle-position'

/**
 * Насколько палец должен уехать, чтобы это считалось переносом.
 *
 * Четыре пикселя: на сенсорном экране палец смещается на один-два даже при
 * обычном нажатии, а осознанный перенос начинается с заметно большего.
 */
const DRAG_THRESHOLD_PX = 4

/**
 * Отступ от края экрана — одинаковый со всех четырёх сторон.
 *
 * Было 8, и этого не хватало: вокруг кнопки идёт кольцо-ободок, оно выходит за
 * её геометрические границы ещё на четыре точки, и в углу экрана ободок
 * срезался. Кнопка выглядела обрезанной, а не лежащей поверх.
 *
 * 20 — это ободок плюс запас, при котором круг заведомо целый на любом
 * разрешении. Заодно палец достаёт кнопку с любой стороны, не задевая края
 * экрана: на моноблоке у самой кромки промахнуться легко.
 */
const EDGE_GAP_PX = 20

/**
 * Отступ ПРИСТЫКОВАННОЙ кнопки — той, что села в шею.
 *
 * Меньше обычного, и в этом весь смысл: кнопка должна сидеть в перемычке
 * глубоко, а не касаться края краешком. Шесть точек оставляют кольцо-ободок
 * целиком в кадре и при этом дают силуэт «край принял кнопку в себя», а не
 * «кнопка приставлена к краю снаружи».
 *
 * Совпадает с `--neck-reach` в VirtualKeyboard.css: перемычка тянется ровно на
 * столько же. Разойдутся — между шеёй и кромкой появится щель.
 */
const DOCKED_GAP_PX = 6

/**
 * Высота строки списка, которую кнопка не должна закрывать.
 *
 * Кнопка висит поверх рабочего экрана, и внизу под ней всегда что-то есть —
 * последняя позиция чека, последний товар в каталоге, последняя строка отчёта.
 * Прижатая к нижнему краю, она перекрывает именно её, а до этой строки чаще
 * всего и тянутся: только что пробитый товар стоит последним.
 *
 * Поэтому место по умолчанию — на строку выше низа. Значение с запасом по
 * самой высокой строке в приложении (карточка товара в каталоге). Это только
 * стартовое место: перетащить кнопку можно куда угодно, включая низ.
 */
const LAST_ROW_H_PX = 56

/**
 * Насколько кадр гасит скорость после броска.
 *
 * 0.965 на кадр — это примерно секунда заметного движения. Было 0.85, то есть
 * около десятой доли секунды: бросок гас почти мгновенно, и кнопка вела себя
 * не как предмет, а как перетаскиваемый значок, который отпустили. Живое
 * поведение требует, чтобы она ещё летела и плавно тормозила.
 *
 * Число на кадр, а не на секунду, но применяется по часам (см. glide): при
 * просадке отрисовки торможение остаётся тем же на глаз.
 */
const FRICTION = 0.965

/**
 * Потолок скорости броска, пикселей за миллисекунду.
 *
 * Резкий взмах пальцем даёт скорость, при которой кнопка пересекает экран за
 * пару кадров и попасть куда хотел невозможно. 3.2 — это примерно ширина
 * экрана за секунду: бросить сильно можно, промахнуться мимо края нельзя.
 */
const MAX_SPEED = 3.2

/** Ниже этой скорости (пикселей за миллисекунду) движение останавливается. */
const STOP_SPEED = 0.04

/**
 * Насколько близко к кромке кнопка должна ОСТАНОВИТЬСЯ, чтобы сесть в шею.
 *
 * Проверяется один раз, в конце полёта, а не каждый кадр. Пока проверка стояла
 * в каждом кадре и зона была шире самой кнопки (1.2), бросок в сторону края
 * обрывался через пару кадров: кнопку засасывало сразу, полёта не было видно.
 *
 * 0.6 — чуть больше половины кнопки. Прижатая к кромке кнопка стоит ровно в
 * EDGE_GAP_PX, и такой зоны хватает, чтобы отличить «долетела и упёрлась» от
 * «остановилась неподалёку»: во втором случае она останется там, где её
 * оставили, а к краю её притянет отложенное прилипание.
 *
 * Считается от стороны кнопки, а не в абсолютных точках — на 4K та же зона в
 * пикселях была бы вдвое уже на глаз.
 */
const CATCH_ZONE_RATIO = 0.8

/**
 * Прилипание к боковому краю.
 *
 * Кнопка всегда встаёт к левому или правому краю — тому, что ближе, — и никогда
 * не остаётся посреди экрана. Так же ведёт себя плавающая кнопка на телефоне, и
 * причина та же: посреди экрана она закрывает работу, а у края всегда под рукой
 * и всегда на предсказуемом месте. Заодно исчезает вопрос «куда её положить,
 * чтобы не мешала» — класть её можно грубо, доводит она себя сама.
 *
 * ЭТО И ЕСТЬ «СКОРОСТЬ ЗАСАСЫВАНИЯ»: сколько длится сам переезд к краю или в
 * угол, когда палец уже отпущен. Больше число — медленнее и мягче переезд.
 * Было 220 — кнопка перескакивала почти мгновенно, и на глаз это читалось не
 * как движение, а как рывок.
 */
const SNAP_MS = 150

/**
 * Сколько кнопка стоит на месте, прежде чем её притянет к краю.
 *
 * Прилипание сразу после отпускания оказалось слишком назойливым: кнопку
 * ставили в нужное место, а она тут же уезжала. Две секунды, наоборот, читались
 * как «зависла»: человек уже отвёл руку, а она всё стоит.
 *
 * Секунда — середина: видно, где кнопка оказалась, и ждать её решения не
 * приходится. Столько же ждёт и превращение в уголок — это одно и то же
 * событие, и расходиться им нельзя.
 *
 * Отсчёт сбрасывается новым касанием: поймал кнопку — она снова твоя.
 */
const SNAP_DELAY_MS = 100

/**
 * За какое время до отпускания считается скорость броска.
 *
 * По последним 80 мс, а не по всему пути: важно, куда палец двигался в самом
 * конце. Если человек провёл кнопку через весь экран и остановился, чтобы
 * поставить её точно, — бросок не засчитывается, и она встаёт на место.
 */
const VELOCITY_WINDOW_MS = 80

/**
 * Свободное положение: кнопка не подходит к краю ближе, чем на EDGE_GAP_PX.
 *
 * К углам это не относится — там кнопка становится уголком и обязана лечь
 * вплотную, см. cornerOrigin.
 */
function clamp(position: HandlePosition, size: number): HandlePosition {
  const maxX = Math.max(EDGE_GAP_PX, window.innerWidth - size - EDGE_GAP_PX)
  const maxY = Math.max(EDGE_GAP_PX, window.innerHeight - size - EDGE_GAP_PX)
  return {
    x: Math.min(Math.max(position.x, EDGE_GAP_PX), maxX),
    y: Math.min(Math.max(position.y, EDGE_GAP_PX), maxY),
  }
}

/**
 * Углы, в которых кнопка меняет форму на уголок.
 *
 * Смысл превращения: у обычного края круг остаётся кругом и честно занимает
 * место, а угол экрана всё равно пустует — вписанная в него четверть круга
 * закрывает собой ровно тот кусок, который и так не работает, и остаётся такой
 * же крупной целью для пальца.
 */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | null

/**
 * Зона магнита — насколько близко к двум краям сразу, чтобы кнопку потянуло в
 * угол.
 *
 * Считается от стороны кнопки, а не в абсолютных точках: на моноблоке 4K та же
 * зона в пикселях была бы вдвое меньше на глаз.
 *
 * Было 1.5 — почти семьдесят точек от каждого края. Кнопку утягивало в угол
 * задолго до того, как она к нему подходила, и поставить её рядом с углом было
 * нельзя: палец вёл в одну сторону, кнопка ехала в другую. 1.0 — ровно сторона
 * кнопки: в угол по-прежнему попадаешь намеренно, но рядом с углом кнопка
 * слушается пальца.
 */
const MAGNET_ZONE_RATIO = 1.50

/**
 * Насколько сильно магнит тянет к углу в самой близкой точке зоны.
 *
 * Не единица: при полном притяжении кнопка прыгала бы в угол, стоило пальцу
 * коснуться зоны, и вытащить её обратно было бы нельзя — она возвращалась бы
 * при каждом движении.
 *
 * 0.35 вместо прежних 0.55: тянет заметно, но кнопка идёт за пальцем, а не
 * борется с ним. Ноль выключает притяжение при переносе совсем — кнопка тогда
 * встанет ровно туда, куда её привели, а в угол её доведёт только прилипание
 * после отпускания.
 */
const MAGNET_STRENGTH = 0.35

/**
 * Насколько слабее магнит тянет, когда кнопку УВОДЯТ от угла.
 *
 * Вытащить уголок обратно на середину экрана при симметричном магните тяжело:
 * палец ведёт наружу, магнит тянет внутрь, и кнопка идёт рывками — это и
 * читалось как «щелчок» при вытаскивании. Направление движения известно
 * (сравниваем расстояние до угла с предыдущим кадром), и на пути ОТ угла
 * притяжение почти снимается: положить кнопку в угол по-прежнему легко, забрать
 * — тоже.
 */
const MAGNET_RELEASE = 0.12

/**
 * Жёсткость пружины, которая втягивает кнопку в угол, 1/мс².
 *
 * Вместе с критическим затуханием (ниже) даёт время успокоения около 350 мс:
 * кнопка подъезжает к углу и останавливается в нём, не проскакивая и не
 * пружиня обратно. Больше — жёстче и резче, меньше — кнопка долго доползает.
 */
const CORNER_STIFFNESS = 2.04e-4

/**
 * Затухание пружины. РОВНО критическое: 2·√k.
 *
 * Меньше — кнопка проскакивает угол и возвращается, то есть пружинит; больше —
 * подползает вяло. Записано формулой, а не числом, чтобы правка жёсткости не
 * оставляла затухание от прежней.
 */
const CORNER_DAMPING = 2 * Math.sqrt(CORNER_STIFFNESS)

/**
 * Максимальный шаг интегрирования пружины, мс.
 *
 * Пружина считается численно, и при большом шаге численная схема расходится —
 * кнопка улетает за экран вместо того, чтобы сесть в угол. Кадр в 50 мс (а на
 * моноблоке при загруженной кассе такие бывают) разбивается на несколько
 * шагов по восемь.
 */
const CORNER_STEP_MS = 8

/**
 * Сколько кнопка пролетела бы до полной остановки при текущей скорости, мс.
 *
 * Трение гасит скорость геометрически: за кадр она умножается на FRICTION.
 * Сумма всего пути — это сумма геометрической прогрессии, то есть скорость,
 * умноженная на длительность кадра и делённая на (1 − FRICTION).
 *
 * Нужно, чтобы понять, КУДА летит кнопка, ещё в начале полёта: если она
 * остановилась бы в углу, втягивание начинается сразу, а не после удара о
 * невидимую стену на двадцати точках от кромки.
 */
const GLIDE_REACH_MS = 16.67 / (1 - FRICTION)

/**
 * Насколько кнопка уходит ЗА кромки, когда садится в угол.
 *
 * Раньше уголок вставал ровно по кромкам (0, 0) и выглядел приложенным к углу
 * снаружи. Пять точек утапливают его за обе кромки: видимой остаётся не вся
 * четверть круга, а её большая часть, и вместе с перемычкой по обеим сторонам
 * угла получается один силуэт, выросший из кромки, а не предмет, положенный
 * рядом.
 *
 * Ровно пять, а не больше: значок внутри уголка смещён к углу на 16% и при
 * большем утапливании начал бы срезаться кромкой экрана.
 */
const CORNER_SINK_PX = 5

/** Левый верхний угол самой кнопки, когда она уголком лежит в углу экрана. */
function cornerOrigin(corner: Exclude<Corner, null>, size: number): HandlePosition {
  return {
    x: corner.endsWith('left')
      ? -CORNER_SINK_PX
      : Math.max(0, window.innerWidth - size + CORNER_SINK_PX),
    y: corner.startsWith('top')
      ? -CORNER_SINK_PX
      : Math.max(0, window.innerHeight - size + CORNER_SINK_PX),
  }
}

/**
 * В зоне какого угла сейчас кнопка. `null` — ни в одной, остаётся кругом.
 *
 * Отсчёт от самой кромки экрана, а не от EDGE_GAP_PX: в углу кнопка ложится
 * вплотную, и зона обязана дотягиваться до того места, где она в итоге встанет.
 */
function cornerAt(position: HandlePosition, size: number): Corner {
  const zone = size * MAGNET_ZONE_RATIO
  const nearLeft = position.x <= zone
  const nearRight = position.x >= window.innerWidth - size - zone
  const nearTop = position.y <= zone
  const nearBottom = position.y >= window.innerHeight - size - zone

  if (nearTop && nearLeft) return 'top-left'
  if (nearTop && nearRight) return 'top-right'
  if (nearBottom && nearLeft) return 'bottom-left'
  if (nearBottom && nearRight) return 'bottom-right'
  return null
}

/**
 * У какого края стоит кнопка, если она не в углу.
 *
 * Отдельно от `cornerAt`, а не внутри него: угол меняет форму на уголок, а
 * край — только добавляет «шею», перемычку от кромки к кнопке. Кнопка при
 * этом остаётся круглой, и логика прилипания её не касается.
 *
 * Функция чистая и ничего не решает за прилипанием: она только читает уже
 * посчитанное положение. Само прилипание — в snapToEdge, и оно не изменено.
 */
export type Edge = 'left' | 'right' | 'top' | 'bottom' | null

/**
 * Допуск, с которым положение считается «у края».
 *
 * Прилипание ставит кнопку ровно на EDGE_GAP_PX, но доводка идёт кадрами и
 * последний кадр может не дойти доли пикселя. Полтора пикселя закрывают это,
 * не задевая соседние положения.
 */
const EDGE_TOLERANCE_PX = 1.5

/**
 * Достаточно ли близко к любому краю, чтобы край поймал летящую кнопку.
 *
 * Чистая проверка положения. Прилипанием и углами не занимается — только
 * отвечает на вопрос «кнопка встала у кромки?» в конце полёта.
 */
function nearEdge(position: HandlePosition, size: number): boolean {
  const zone = size * CATCH_ZONE_RATIO
  return (
    position.x <= EDGE_GAP_PX + zone ||
    position.y <= EDGE_GAP_PX + zone ||
    position.x >= window.innerWidth - size - EDGE_GAP_PX - zone ||
    position.y >= window.innerHeight - size - EDGE_GAP_PX - zone
  )
}

/**
 * Куда встаёт кнопка, пристыкованная к заданной кромке, при текущем размере окна.
 *
 * Нужна отдельно от прилипания: после смены размера окна (F11, разворот,
 * подключение второго монитора) кнопку надо посадить обратно к ТОЙ ЖЕ кромке,
 * а не пересчитывать, куда бы она прилипла заново.
 */
function dockedOrigin(edge: Exclude<Edge, null>, position: HandlePosition, size: number): HandlePosition {
  const maxX = Math.max(DOCKED_GAP_PX, window.innerWidth - size - DOCKED_GAP_PX)
  const maxY = Math.max(DOCKED_GAP_PX, window.innerHeight - size - DOCKED_GAP_PX)
  // Поперёк кромки кнопка прижимается, вдоль — остаётся там же, где стояла,
  // только не вылезая за окно.
  const alongX = Math.min(Math.max(position.x, EDGE_GAP_PX), Math.max(EDGE_GAP_PX, window.innerWidth - size - EDGE_GAP_PX))
  const alongY = Math.min(Math.max(position.y, EDGE_GAP_PX), Math.max(EDGE_GAP_PX, window.innerHeight - size - EDGE_GAP_PX))

  switch (edge) {
    case 'left':
      return { x: DOCKED_GAP_PX, y: alongY }
    case 'right':
      return { x: maxX, y: alongY }
    case 'top':
      return { x: alongX, y: DOCKED_GAP_PX }
    case 'bottom':
      return { x: alongX, y: maxY }
  }
}

function edgeAt(position: HandlePosition, size: number): Edge {
  // В углу «шеи» нет: там кнопка сама становится частью края.
  if (cornerAt(position, size)) return null

  // Сравнение с пристыкованным отступом, а не со свободным: шея рисуется
  // только у кнопки, которая действительно села в край.
  const dockX = Math.max(DOCKED_GAP_PX, window.innerWidth - size - DOCKED_GAP_PX)
  const dockY = Math.max(DOCKED_GAP_PX, window.innerHeight - size - DOCKED_GAP_PX)

  if (Math.abs(position.x - DOCKED_GAP_PX) <= EDGE_TOLERANCE_PX) return 'left'
  if (Math.abs(position.x - dockX) <= EDGE_TOLERANCE_PX) return 'right'
  if (Math.abs(position.y - DOCKED_GAP_PX) <= EDGE_TOLERANCE_PX) return 'top'
  if (Math.abs(position.y - dockY) <= EDGE_TOLERANCE_PX) return 'bottom'
  return null
}

/**
 * Притяжение к углу во время переноса — то самое «засасывание».
 *
 * Кнопка не прыгает в угол и не встаёт туда по факту отпускания: она едет к
 * нему тем сильнее, чем ближе палец, и это видно прямо в движении. Сила падает
 * от края зоны к её границе, поэтому вход в зону не даёт рывка — притяжение
 * нарастает плавно.
 *
 * Возвращает положение, которое надо нарисовать, и угол, если он есть.
 */
function applyMagnet(
  position: HandlePosition,
  size: number,
  previousDistance: number | null,
): { position: HandlePosition; corner: Corner; distance: number } {
  const corner = cornerAt(position, size)
  if (!corner) return { position, corner: null, distance: Number.POSITIVE_INFINITY }

  const origin = cornerOrigin(corner, size)
  const zone = size * MAGNET_ZONE_RATIO
  // Насколько глубоко в зоне: 0 на её границе, 1 в самом углу.
  const distance = Math.hypot(position.x - origin.x, position.y - origin.y)
  const depth = Math.max(0, Math.min(1, 1 - distance / (zone * Math.SQRT2)))

  /*
    Магнит несимметричен по направлению движения.

    К углу — тянет в полную силу: положить кнопку в угол должно быть легко и
    видно. ОТ угла — почти отпускает: иначе палец ведёт наружу, магнит внутрь,
    и кнопка идёт рывками. Именно это читалось как «щелчок» при вытаскивании
    уголка.

    Направление берётся из сравнения с расстоянием на предыдущем кадре. Первый
    кадр в зоне сравнивать не с чем — считаем, что заходим внутрь.
  */
  const leaving = previousDistance !== null && distance > previousDistance
  const pull = depth * MAGNET_STRENGTH * (leaving ? MAGNET_RELEASE : 1)

  return {
    position: {
      x: position.x + (origin.x - position.x) * pull,
      y: position.y + (origin.y - position.y) * pull,
    },
    corner,
    distance,
  }
}

function readStored(): HandlePosition | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<HandlePosition>
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return null
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null
    return { x: parsed.x, y: parsed.y }
  } catch {
    // Приватный режим или испорченная запись — просто встанем на место по
    // умолчанию, ронять из-за этого клавиатуру незачем.
    return null
  }
}

function store(position: HandlePosition): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
  } catch {
    /* не запомнилось — не беда, кнопка всё равно на месте до перезапуска */
  }
}

export type DraggableHandle = {
  /** Вешается на переносимый элемент — через него идёт вся отрисовка переноса. */
  ref: (node: HTMLElement | null) => void
  dragging: boolean
  /**
   * В каком углу лежит кнопка. `null` — свободно висит и остаётся кругом.
   *
   * Форму по нему выбирает CSS (класс `is-corner`), а переход между круглой и
   * угловой формой идёт анимацией `border-radius` — см. VirtualKeyboard.css.
   */
  corner: Corner
  /**
   * У какого края стоит кнопка. `null` — свободно висит или лежит в углу.
   *
   * По нему рисуется «шея» — перемычка от кромки экрана к кнопке (см.
   * VirtualKeyboard.css). Форму кнопки это не меняет: у края она остаётся
   * кругом, а прилипание работает ровно как работало.
   */
  edge: Edge
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * Почему перенос не идёт через состояние React.
 *
 * Сначала так и было: каждое движение указателя вызывало setState, и кнопка
 * заметно отставала от пальца, дёргалась и подтормаживала — особенно на
 * моноблоке, где рядом открыт весь экран кассы. Причина не в React как таковом,
 * а в цене одного кадра: события указателя приходят чаще, чем экран успевает
 * перерисоваться, и каждое из них тянуло за собой полную отрисовку поддерева.
 *
 * Поэтому во время переноса React не участвует вовсе: положение пишется прямо в
 * `style.transform` узла, по одному разу на кадр экрана (`requestAnimationFrame`),
 * а промежуточные события просто обновляют цель. `transform` считает
 * композитор — раскладка не пересчитывается, и кнопка идёт за пальцем без
 * отставания. В состояние положение попадает один раз, когда палец отпустили.
 */
/*
 * ГДЕ ЧТО НАСТРАИВАЕТСЯ — все числа этого файла собраны выше, в одном месте:
 *
 *   FRICTION           насколько быстро гаснет бросок (меньше — короче полёт)
 *   MAX_SPEED          потолок скорости: сильнее «кинуть» не получится
 *   BOUNCE             упругость краёв экрана
 *   SNAP_DELAY_MS      сколько кнопка стоит, прежде чем её притянет к краю
 *   SNAP_MS            длительность самой доводки к краю
 *   DRAG_THRESHOLD_PX  с какого смещения нажатие считается переносом
 *   EDGE_GAP_PX        отступ от края экрана
 *
 * Прилипание целиком выключается в шапке клавиатуры кнопкой «К краю».
 */
export function useDraggableHandle(size: number, onTap: () => void): DraggableHandle {
  const [position, setPosition] = useState<HandlePosition>(() => {
    const stored = readStored()
    /*
      Место по умолчанию — слева внизу, но на строку выше самого низа.

      Отступ слева ровно тот же, что и снизу (EDGE_GAP_PX): кнопка стоит в
      углу симметрично, а не «почти в углу». Дополнительный LAST_ROW_H_PX
      поднимает её над последней строкой списка — той, до которой тянутся
      чаще всего.
    */
    const fallback = {
      x: EDGE_GAP_PX,
      y: window.innerHeight - size - EDGE_GAP_PX - LAST_ROW_H_PX,
    }
    if (!stored) return clamp(fallback, size)
    /*
      Сохранённое место могло быть углом.

      Тогда ставим кнопку ровно в угол, а не в записанные координаты. Разница
      важна: запись могла быть сделана до появления уголка или на экране
      другого размера, и уголок, вставший в паре точек от угла, выглядит
      сломанным — у него внешние стороны обязаны лечь по кромкам окна.

      Выравнивать по отступу такое место нельзя: уголок отъехал бы к центру и
      перестал быть уголком.
    */
    const held = cornerAt(stored, size)
    if (held) return cornerOrigin(held, size)
    // Пристыкованное место сохраняем как есть: `clamp` вернул бы кнопку к
    // свободному отступу в 20 точек, и после перезапуска она вылезала бы из
    // шеи, оставив перемычку торчать в пустоту.
    return edgeAt(stored, size) ? stored : clamp(stored, size)
  })
  const [dragging, setDragging] = useState(false)
  /**
   * В каком углу лежит кнопка. Считается сразу из восстановленного места:
   * иначе кнопка, оставленная уголком, после перезапуска возвращалась бы
   * круглой и сама себя не узнавала.
   */
  const [corner, setCorner] = useState<Corner>(() => cornerAt(position, size))

  /*
    У какого края кнопка стоит сейчас.

    Считается из уже зафиксированного положения, а не из цели переноса, и
    это принципиально по двум причинам.

    Первая — так «шея» не участвует в переносе вовсе: во время движения
    `position` не меняется (перенос идёт мимо React, прямо в transform), и
    перемычка не мигает под пальцем на каждом кадре. Она появляется ровно
    тогда, когда кнопка встала.

    Вторая — прилипание остаётся нетронутым. Это чтение уже посчитанного
    места, а не участие в решении, куда кнопку вести.
  */
  const edge = useMemo(
    () => (dragging ? null : edgeAt(position, size)),
    [dragging, position, size],
  )

  /*
    Та же кромка, но доступная из обработчиков, которые живут вне отрисовки.

    Обработчику смены размера окна нужно знать, у какой кромки кнопка стояла ДО
    того, как окно изменилось. Замыкание над `edge` держало бы значение с того
    рендера, когда подписка была создана; ссылка всегда показывает текущее.
  */
  const edgeRef = useRef<Edge>(edge)
  edgeRef.current = edge

  const nodeRef = useRef<HTMLElement | null>(null)
  /** Смещение точки захвата внутри кнопки и признак «уже поехали». */
  const grabRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  /** Куда кнопка должна встать в ближайшем кадре. */
  const targetRef = useRef<HandlePosition>(position)
  const frameRef = useRef<number | null>(null)
  /** Последние точки пути — по ним считается скорость броска. */
  const trailRef = useRef<{ x: number; y: number; at: number }[]>([])
  /** Кадр инерции, отдельно от кадра отрисовки: их гасят в разные моменты. */
  const glideRef = useRef<number | null>(null)
  /** Отложенное прилипание к краю. Сбрасывается новым касанием. */
  const snapTimerRef = useRef<number | null>(null)
  /**
   * Расстояние до угла на предыдущем кадре переноса.
   *
   * По нему магнит понимает, ведут кнопку К углу или ОТ него, и во втором
   * случае почти отпускает — иначе вытащить уголок обратно нельзя без рывков.
   * `null` — кнопка вне зоны любого угла.
   */
  const cornerDistanceRef = useRef<number | null>(null)

  const cancelSnapTimer = useCallback(() => {
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current)
      snapTimerRef.current = null
    }
  }, [])

  const paint = useCallback(() => {
    frameRef.current = null
    const node = nodeRef.current
    if (!node) return
    const { x, y } = targetRef.current
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }, [])

  /** Просит перерисовать не чаще одного раза на кадр экрана. */
  const schedulePaint = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(paint)
  }, [paint])

  const ref = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node
      // Начальное положение ставится тем же способом, что и все последующие:
      // иначе первый кадр кнопка провела бы в левом верхнем углу.
      if (node) paint()
    },
    [paint],
  )

  /*
    Окно поменяло размер — кнопка остаётся там же, где стояла ОТНОСИТЕЛЬНО КРАЯ.

    Три случая, и все три разные:

      уголок    — пересчитывается в новый угол. Иначе после разворота окна он
                  отъезжал бы к центру и переставал быть уголком.
      у кромки  — прижимается к ТОЙ ЖЕ кромке заново. Это чинит F11: кнопка,
                  сидевшая в шее у правого края, после смены размера окна
                  оказывалась посреди экрана, `edgeAt` переставал узнавать в ней
                  пристыкованную, класс `is-docked` слетал — и шея исчезала.
                  Со стороны выглядело как «нажал F11 и шея пропала».
      свободна  — просто не даём уехать за край.

    Прежняя кромка берётся из `edgeRef`, а не считается заново: считать её по
    новому размеру окна бессмысленно — кнопка в этот момент уже не у края,
    именно поэтому всё и ломалось.
  */
  useEffect(() => {
    const onResize = () => {
      const held = cornerAt(targetRef.current, size)
      const wasEdge = edgeRef.current
      const fixed = held
        ? cornerOrigin(held, size)
        : wasEdge
          ? dockedOrigin(wasEdge, targetRef.current, size)
          : clamp(targetRef.current, size)
      targetRef.current = fixed
      setCorner(held)
      setPosition(fixed)
      store(fixed)
      schedulePaint()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [size, schedulePaint])

  // Незавершённые кадры не должны пережить размонтирование — ни отрисовка, ни
  // полёт по инерции.
  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      if (glideRef.current !== null) window.cancelAnimationFrame(glideRef.current)
      if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current)
    },
    [],
  )

  /**
   * Втягивание в угол — ЕДИНСТВЕННЫЙ способ, которым кнопка туда садится.
   *
   * Сюда сходятся все три пути: бросок, который целится в угол; отпускание
   * пальца в зоне угла; отложенное прилипание, если кнопку оставили рядом.
   * Раньше у каждого был свой: бросок бился о `clamp` и потом прыгал доводкой
   * за 150 мс, отпускание вызывало ту же доводку сразу. Отсюда и «удар,
   * остановка, посадка» — три разных движения подряд вместо одного.
   *
   * Пружина критически затухающая: подводит к углу и останавливает ровно в
   * нём, без проскока и без отдачи. Начальная скорость — та, с которой кнопка
   * пришла: полёт не обрывается, а перетекает в посадку. Отпустили без
   * броска — скорость нулевая, и кнопка просто мягко втягивается.
   *
   * `clamp` здесь не применяется намеренно: он и был той невидимой стеной, а
   * уголок обязан уйти за кромки (CORNER_SINK_PX).
   */
  const captureIntoCorner = useCallback(
    (corner: Exclude<Corner, null>, vx: number, vy: number) => {
      const origin = cornerOrigin(corner, size)
      let speedX = vx
      let speedY = vy
      let previous = performance.now()
      // Форма меняется на входе в посадку, а не по её концу: человек видит,
      // куда кнопка встанет, пока она ещё едет.
      setCorner((held) => (held === corner ? held : corner))

      const step = (now: number) => {
        const elapsed = Math.min(50, now - previous)
        previous = now
        let { x, y } = targetRef.current

        // Кадр дробится: при шаге в 50 мс (а на загруженной кассе такие
        // бывают) численная схема пружины расходится, и кнопка улетела бы за
        // экран вместо посадки.
        let left = elapsed
        while (left > 0) {
          const dt = Math.min(CORNER_STEP_MS, left)
          left -= dt
          speedX += (-CORNER_STIFFNESS * (x - origin.x) - CORNER_DAMPING * speedX) * dt
          speedY += (-CORNER_STIFFNESS * (y - origin.y) - CORNER_DAMPING * speedY) * dt
          x += speedX * dt
          y += speedY * dt
        }
        targetRef.current = { x, y }
        schedulePaint()

        const settled =
          Math.hypot(x - origin.x, y - origin.y) < 0.4 && Math.hypot(speedX, speedY) < STOP_SPEED
        if (!settled) {
          glideRef.current = window.requestAnimationFrame(step)
          return
        }
        // Села. Последний кадр ставит кнопку ровно в угол: доля пикселя между
        // уголком и кромкой видна как светлая полоска вдоль края.
        glideRef.current = null
        targetRef.current = origin
        schedulePaint()
        setDragging(false)
        setPosition(origin)
        store(origin)
      }

      glideRef.current = window.requestAnimationFrame(step)
    },
    [size, schedulePaint],
  )

  /**
   * Доводка к ближайшему краю — любому из четырёх.
   *
   * Считается расстояние до каждого края (слева, справа, сверху, снизу), и
   * кнопка едет к тому, который ближе. Только к боковым, как было сначала, — не
   * годится: кнопку, поднятую к верхней кромке, уводило вбок через пол-экрана,
   * хотя до верха ей оставалось несколько точек.
   *
   * Вторая координата при этом сохраняется: к какому краю прижаться, человек
   * показывает грубым движением, а вдоль края место выбирает сам.
   */
  const snapToEdge = useCallback(() => {
    const from = targetRef.current
    // Доводка ведёт к ПРИСТЫКОВАННОМУ отступу (6), а не к свободному (20):
    // кнопка садится в шею глубоко. Вдоль края место сохраняется — куда
    // прижаться, человек показал броском, а где именно встать вдоль стороны,
    // выбирает сам.
    const dockX = Math.max(DOCKED_GAP_PX, window.innerWidth - size - DOCKED_GAP_PX)
    const dockY = Math.max(DOCKED_GAP_PX, window.innerHeight - size - DOCKED_GAP_PX)

    /*
      В углу доводка не участвует вовсе — там работает пружина.

      Раньше здесь стояла та же линейная доводка за 150 мс, что и к краю, и
      она же давала «прыжок» в угол после остановки. Теперь угол ведёт
      `captureIntoCorner`, и путь туда ровно один.
    */
    const nearCorner = cornerAt(from, size)
    if (nearCorner) {
      captureIntoCorner(nearCorner, 0, 0)
      return
    }

    const to = [
      { gap: from.x, to: { x: DOCKED_GAP_PX, y: from.y } },
      { gap: window.innerWidth - size - from.x, to: { x: dockX, y: from.y } },
      { gap: from.y, to: { x: from.x, y: DOCKED_GAP_PX } },
      { gap: window.innerHeight - size - from.y, to: { x: from.x, y: dockY } },
    ].reduce((best, item) => (item.gap < best.gap ? item : best)).to
    const started = performance.now()

    const step = (now: number) => {
      const ratio = Math.min(1, (now - started) / SNAP_MS)
      // Замедление к концу: кнопка подъезжает к краю, а не втыкается в него.
      const eased = 1 - (1 - ratio) ** 3
      targetRef.current = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
      }
      schedulePaint()
      if (ratio < 1) {
        glideRef.current = window.requestAnimationFrame(step)
        return
      }
      glideRef.current = null
      setDragging(false)
      // Встала у кромки — уголком она стать не может: угол ушёл в пружину
      // выше, сюда доходит только доводка к прямому краю.
      setCorner(null)
      setPosition(targetRef.current)
      store(targetRef.current)
    }

    glideRef.current = window.requestAnimationFrame(step)
  }, [size, schedulePaint, captureIntoCorner])

  /**
   * Отложенное прилипание.
   *
   * Кнопка остаётся там, где её отпустили, и только через `SNAP_DELAY_MS`
   * подъезжает к ближайшему краю. Сразу — слишком назойливо: человек ставит
   * кнопку в нужное место, а она уезжает у него из-под пальца.
   *
   * Настройка читается в момент отпускания, а не при монтировании: переключатель
   * стоит в шапке самой клавиатуры, и новое значение должно действовать со
   * следующего же переноса, без перезапуска.
   */
  const scheduleSnap = useCallback(() => {
    cancelSnapTimer()
    if (!loadSettings().system.keyboardSnapToEdge) return
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = null
      snapToEdge()
    }, SNAP_DELAY_MS)
  }, [cancelSnapTimer, snapToEdge])

  const glide = useCallback(
    (vx: number, vy: number) => {
      // Потолок скорости: резкий взмах иначе уносит кнопку через весь экран за
      // пару кадров, и попасть куда хотел невозможно.
      const speed = Math.hypot(vx, vy)
      const scale = speed > MAX_SPEED ? MAX_SPEED / speed : 1
      let speedX = vx * scale
      let speedY = vy * scale
      let previous = performance.now()

      const step = (now: number) => {
        // Шаг считается от часов, а не от числа кадров: при просадке отрисовки
        // кнопка иначе замедлялась бы вместе с ней. Потолок в три кадра — от
        // случая, когда вкладку заморозили и вернули: без него кнопка улетела
        // бы на другой конец экрана одним прыжком.
        const elapsed = Math.min(50, now - previous)
        const frames = elapsed / 16.67
        previous = now

        const { x: fromX, y: fromY } = targetRef.current
        const x = fromX + speedX * elapsed
        const y = fromY + speedY * elapsed

        /*
          Полёт целится в угол — передаём его пружине, не дожидаясь остановки.

          Точка, где кнопку остановило бы трение, считается наперёд
          (GLIDE_REACH_MS). Если она в зоне угла — значит, кнопку туда и
          бросили, и тормозить о `clamp` по дороге незачем: именно этот `clamp`
          и был невидимой стеной, о которую кнопка ударялась.

          Проверяется и текущее положение тоже: короткий толчок изнутри зоны
          угла никуда не долетает, но втянуться всё равно должен.

          Скорость передаётся КАК ЕСТЬ — движение продолжается тем же, каким
          было, и переход из полёта в посадку не виден.
        */
        const resting = { x: x + speedX * GLIDE_REACH_MS, y: y + speedY * GLIDE_REACH_MS }
        const aimed = cornerAt(resting, size) ?? cornerAt({ x, y }, size)
        if (aimed) {
          glideRef.current = null
          targetRef.current = { x, y }
          captureIntoCorner(aimed, speedX, speedY)
          return
        }

        /*
          Отскока от края больше нет.

          Раньше кнопка отражалась от кромки с коэффициентом 0.28 и улетала
          обратно к центру: бросили в правый край — вернулась в середину
          экрана. Для мяча это правильно, для кнопки, которую отправили к
          краю, — нет. Долетела и осталась.

          Вылет за экран лечится тем же `clamp`: кнопка мягко возвращается
          внутрь, к ближайшему краю, а не застревает снаружи.
        */
        targetRef.current = clamp({ x, y }, size)
        schedulePaint()

        speedX *= FRICTION ** frames
        speedY *= FRICTION ** frames

        /*
          Пока кнопка летит — её никто не трогает.

          Раньше край ловил её на подлёте: стоило войти в зону шириной больше
          самой кнопки, полёт обрывался и управление уходило доводке. На бросок
          в сторону края это срабатывало через пару кадров, и со стороны
          выглядело так, будто кнопку засасывает сразу, а броска нет вовсе.

          Теперь бросок доигрывается до конца: трение гасит скорость, `clamp`
          не пускает за кромку. Решение, садиться ли в шею, принимается один раз
          — там, где кнопка остановилась.
        */
        if (Math.hypot(speedX, speedY) < STOP_SPEED) {
          glideRef.current = null

          /*
            Долетела и встала у самой кромки — сажаем в шею сразу.

            Ждать здесь секунду отложенного прилипания нельзя: кнопка уже
            стоит у края, и пауза перед тем, как она сдвинется на свои шесть
            точек, читается как подтормаживание. Вдали от краёв наоборот —
            пусть полежит, куда положили, а магнит сработает по таймеру.
          */
          if (nearEdge(targetRef.current, size)) {
            cancelSnapTimer()
            snapToEdge()
            return
          }

          setDragging(false)
          setPosition(targetRef.current)
          store(targetRef.current)
          scheduleSnap()
          return
        }
        glideRef.current = window.requestAnimationFrame(step)
      }

      glideRef.current = window.requestAnimationFrame(step)
    },
    [size, schedulePaint, scheduleSnap, snapToEdge, cancelSnapTimer, captureIntoCorner],
  )

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Новый захват прерывает и полёт, и отложенное прилипание: кнопку поймали.
    if (glideRef.current !== null) {
      window.cancelAnimationFrame(glideRef.current)
      glideRef.current = null
    }
    cancelSnapTimer()

    const rect = event.currentTarget.getBoundingClientRect()
    trailRef.current = []
    // Новый захват — новый отсчёт направления для магнита: иначе первый кадр
    // сравнивался бы с расстоянием из прошлого переноса.
    cornerDistanceRef.current = null
    grabRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false,
    }
    // Захват указателя: палец может уехать за пределы кнопки, и без этого
    // перенос обрывался бы на первом же быстром движении.
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [cancelSnapTimer])

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const grab = grabRef.current
      if (!grab) return
      const free = clamp({ x: event.clientX - grab.dx, y: event.clientY - grab.dy }, size)
      /*
        Магнит. Пока палец далеко от углов, кнопка идёт ровно за ним; у угла её
        начинает тянуть, и тем сильнее, чем ближе, — «засасывает». Это видно
        прямо в движении, а не только по факту отпускания.

        Форма меняется здесь же: как только кнопка попала в зону угла, она
        превращается в уголок, и человек видит, куда именно она встанет, ещё не
        отпустив палец. Вышел из зоны — вернулась к кругу, тоже плавно.
      */
      const magnet = applyMagnet(free, size, cornerDistanceRef.current)
      cornerDistanceRef.current = Number.isFinite(magnet.distance) ? magnet.distance : null
      const next = magnet.position

      if (!grab.moved) {
        const shift = Math.hypot(next.x - targetRef.current.x, next.y - targetRef.current.y)
        if (shift < DRAG_THRESHOLD_PX) return
        grab.moved = true
        // Единственная отрисовка за весь перенос — ради тени «взял в руку».
        setDragging(true)
      }
      // Смена формы — тоже отрисовка, но она случается редко: только на входе
      // в зону угла и на выходе из неё, а не на каждое движение пальца.
      setCorner((previous) => (previous === magnet.corner ? previous : magnet.corner))
      targetRef.current = next
      // Хвост пути — по нему считается скорость броска при отпускании.
      const now = performance.now()
      trailRef.current.push({ ...next, at: now })
      while (trailRef.current.length > 1 && now - trailRef.current[0].at > VELOCITY_WINDOW_MS) {
        trailRef.current.shift()
      }
      schedulePaint()
    },
    [size, schedulePaint],
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const grab = grabRef.current
      grabRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      if (!grab) return
      if (!grab.moved) {
        // Палец не уехал — это было нажатие.
        onTap()
        return
      }

      // Скорость — по хвосту пути, а не по всему переносу: важно, куда палец
      // двигался в последний момент перед отпусканием.
      const trail = trailRef.current
      const first = trail[0]
      const last = trail[trail.length - 1]
      const span = last && first ? last.at - first.at : 0
      const vx = span > 0 ? (last.x - first.x) / span : 0
      const vy = span > 0 ? (last.y - first.y) / span : 0

      /*
        Отпустили в зоне угла — сразу в пружину, с той скоростью, что была.

        Магнит уже показал человеку, куда кнопка встанет, и ждать после этого
        отложенного прилипания значило бы обмануть показанное. Полёт по
        инерции здесь тем более лишний: отпустить кнопку в углу — это и есть
        просьба положить её туда.

        Скорость передаётся даже нулевая: пружина одинаково хорошо принимает и
        брошенную кнопку, и просто отпущенную.
      */
      const held = cornerAt(targetRef.current, size)
      if (held) {
        captureIntoCorner(held, vx, vy)
        return
      }

      if (span > 0) {
        glide(vx, vy)
        return
      }

      // Броска не было — кнопка остаётся там, где отпустили, и к краю её
      // притянет отложенное прилипание (или не притянет, если оно выключено).
      setDragging(false)
      setPosition(targetRef.current)
      store(targetRef.current)
      scheduleSnap()
    },
    [onTap, glide, scheduleSnap, snapToEdge, size],
  )

  return { ref, dragging, corner, edge, onPointerDown, onPointerMove, onPointerUp }
}
