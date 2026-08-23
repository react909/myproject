/**
 * Бренд в шапке приложения — знак и надпись, собранные по выбранной компоновке.
 *
 * Один модуль на все места, где этот блок виден: сама шапка (AppHeader),
 * предпросмотр в редакторе логотипа (LogoStudio), предпросмотр компоновки в
 * настройках шапки (AppHeaderEditor) и предпросмотр результата обрезки внутри
 * ImageCropper. Раньше макет шапки был скопирован в двух редакторах слово в
 * слово, а решение «что именно показывать» — в трёх местах сразу, и они
 * расходились: настройка показывала одно, шапка рисовала другое.
 *
 * Здесь два выхода наружу:
 *  • `headerBrandView` — единственное место, где реквизиты превращаются в
 *    ответ «что стоит в шапке». Никаких условий по месту.
 *  • `HeaderBrand` и `HeaderStripPreview` — сам блок и его превью на тёмной
 *    полосе. Полоса тёмная в обеих темах, и оценивать знак можно только на ней.
 *
 * Надпись — картинка. Пока своего файла нет, название рисуется текстом по
 * шаблону из реквизитов: так шапка выглядит ровно как до появления слота, и
 * обновление не оставляет магазин без названия.
 */

import { FACTORY_BRAND, resolveBrand } from '../brand/brand'
import { LOGO_TEXT_TEMPLATES, NAME_SIZES, headerLayoutParts } from '../onboarding/types'
import type { BrandingData, HeaderLayout } from '../onboarding/types'
import './HeaderBrand.css'

/** Оформление названия, когда оно рисуется текстом, а не картинкой. */
export type BrandNameStyle = {
  fontFamily: string
  fontWeight: number
  fontSize: number
  color?: string
}

/**
 * Что именно стоит в шапке — уже разрешённое, без «если» на стороне вида.
 *
 * Пустая строка в любом поле означает «этой части здесь нет»: вид не решает,
 * почему её нет — потому ли, что компоновка её не предполагает, или потому,
 * что файла ещё не загрузили.
 */
export type HeaderBrandView = {
  layout: HeaderLayout
  /** Знак. */
  mark: string
  /** Надпись картинкой. */
  wordmark: string
  /** Единая картинка: знак и надпись вместе. */
  combined: string
  /** Название текстом — запасной путь, пока картинки надписи нет. */
  name: string
  nameStyle?: BrandNameStyle
  /** Круглый знак — скругляем и картинку. */
  markRound: boolean
  /** Объёмный вид: фаска по контуру и мягкая тень под знаком. */
  emboss: boolean
}

/**
 * Оформление → шапка. Единственное место, где это решается.
 *
 * Второго аргумента здесь больше нет, и это исправление настоящей ошибки.
 * Раньше сюда передавали `storeDisplayName(store)` — название магазина из
 * реквизитов первого шага, — и торговая точка «Глобус» превращала программу в
 * «Глобус». Название интерфейса приходит из бренда (`resolveBrand`), а
 * реквизиты магазина живут своей жизнью и печатаются в чеке.
 */
export function headerBrandView(branding: BrandingData): HeaderBrandView {
  const parts = headerLayoutParts(branding.headerLayout)
  const template =
    LOGO_TEXT_TEMPLATES.find((item) => item.id === branding.logoTextTemplate) ?? LOGO_TEXT_TEMPLATES[0]
  const brand = resolveBrand(branding)

  // Логотип выключен целиком — это решение владельца, и заводской знак вместо
  // него подставлять нельзя: он его как раз и убирал.
  const markVisible = branding.uiLogo && branding.mode !== 'none'
  const mark = markVisible ? brand.mark : ''

  return {
    layout: branding.headerLayout,
    mark: parts.mark ? mark : '',
    wordmark: parts.wordmark ? branding.logoWordmark : '',
    // Единой картинки ещё нет — показываем знак: пустая шапка хуже, чем шапка
    // без надписи, а загрузить файл можно в любой момент.
    combined: parts.combined ? branding.logoCombined || mark : '',
    name: parts.wordmark && !branding.logoWordmark ? brand.name : '',
    nameStyle: {
      fontFamily: template.family,
      fontWeight: template.weight,
      fontSize: NAME_SIZES[branding.logoTextSize],
      color: branding.logoTextColor || undefined,
    },
    markRound: branding.logoShape === 'circle',
    emboss: branding.logoEmboss,
  }
}

/**
 * Блок бренда.
 *
 * Высота фиксирована переменной `--app-header-logo-size` при любой компоновке —
 * шапка не имеет права прыгать от смены настройки. Ширина свободная: магазин
 * приносит и квадратный знак, и широкую надпись, и обрезать чужой бренд по
 * квадрату нельзя.
 *
 * Блок остаётся на месте, даже когда показывать нечего: удержание на нём —
 * единственный вход в скрытые настройки на моноблоке без клавиатуры, и терять
 * эту зону вместе с картинкой нельзя.
 */
export function HeaderBrand({
  view,
  /** Палец лежит на блоке: намёк на скрытый вход. */
  holding = false,
}: {
  view: HeaderBrandView
  holding?: boolean
}) {
  const { layout, mark, wordmark, combined, name, nameStyle, markRound, emboss } = view
  const empty = !mark && !wordmark && !combined && !name

  return (
    <span
      className={`hbrand hbrand--${layout}${emboss ? ' hbrand--emboss' : ''}${
        empty ? ' hbrand--empty' : ''
      }${holding ? ' is-holding' : ''}`}
    >
      {combined && <img className="hbrand__img hbrand__img--combined" src={combined} alt="" />}
      {mark && (
        <img
          className={`hbrand__img hbrand__img--mark${markRound ? ' is-round' : ''}`}
          src={mark}
          alt=""
        />
      )}
      {wordmark && <img className="hbrand__img hbrand__img--wordmark" src={wordmark} alt="" />}
      {!wordmark && !combined && name && (
        <span className="hbrand__name" style={nameStyle} title={name}>
          {name}
        </span>
      )}
      {/* Логотип выключен, надписи нет, компоновка названия не предполагает —
          в шапке всё равно должно что-то стоять. Название бренда, а не строка
          «NurCRM POS», которая была здесь раньше: это третье имя системы в
          интерфейсе, и появлялось оно ровно там, где остальные два исчезали. */}
      {!wordmark && !combined && !name && !mark && (
        <span className="hbrand__system">{FACTORY_BRAND.name}</span>
      )}
    </span>
  )
}

/**
 * Превью шапки — та же тёмная полоса, что и в приложении.
 *
 * Не картинка на белом: логотип на светлом фоне и логотип на тёмной полосе
 * выглядят по-разному, а кассир увидит второе. Часы и плитка «К оплате» стоят
 * рядом не для украшения — по ним видно, сколько места бренд занимает на самом
 * деле и не наезжает ли он на соседей.
 */
export function HeaderStripPreview({ view }: { view: HeaderBrandView }) {
  return (
    <div className="header-strip">
      <HeaderBrand view={view} />
      <time className="header-strip__clock">12:40:07</time>
      <span className="header-strip__tile">К оплате · 0,00 сом</span>
    </div>
  )
}
