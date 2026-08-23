"use strict";
/**
 * OnboardingData — единственный источник истины о магазине.
 *
 * Состав полей продиктован фискальным чеком: каждая строка чека берётся
 * отсюда, и наоборот — здесь нет полей, которые никуда не печатаются и ничего
 * не настраивают. Один и тот же тип используют мастер первого запуска,
 * раздел реквизитов в настройках и модуль печати чека; параллельных
 * интерфейсов для тех же данных заводить нельзя.
 *
 * Соответствие строк чека полям задано в fields.ts (свойство `receiptLine`),
 * чтобы связь была видна в коде, а не только в документации.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NAME_SIZES = exports.SIMPLE_RECEIPT_TITLE = exports.DEFAULT_RECEIPT_FOOTER = exports.DEFAULT_ONBOARDING = exports.SW_VERSION = exports.FFD_VERSION = exports.OWNER_PASSWORD_MIN_LENGTH = exports.PIN_MAX_LENGTH = exports.PIN_MIN_LENGTH = exports.PASSWORD_MIN_LENGTH = exports.ROLL_WIDTHS = exports.LOGO_TEXT_TEMPLATES = exports.HEADER_LAYOUTS = exports.LOGO_SHAPES = exports.TAX_PRESETS = exports.TAX_REGIMES = exports.ANALYTICS_MODES = exports.PAYMENT_METHODS = exports.EDITIONS = exports.FISCAL_MODES = void 0;
exports.taxRegimeHint = taxRegimeHint;
exports.headerLayoutParts = headerLayoutParts;
exports.columnsForRoll = columnsForRoll;
exports.emptyReceiptLogoVariants = emptyReceiptLogoVariants;
exports.receiptLogoSource = receiptLogoSource;
exports.usesOwnReceiptLogo = usesOwnReceiptLogo;
exports.receiptCropSource = receiptCropSource;
exports.emptyLogoVariants = emptyLogoVariants;
exports.isFiscal = isFiscal;
exports.applyTaxRegime = applyTaxRegime;
exports.applyFiscalMode = applyFiscalMode;
exports.createOnboardingDraft = createOnboardingDraft;
exports.storeDisplayName = storeDisplayName;
exports.ownerFullName = ownerFullName;
exports.isOwnerEmailLinked = isOwnerEmailLinked;
exports.effectiveOwnerEmail = effectiveOwnerEmail;
exports.formatOutletAddress = formatOutletAddress;
exports.formatCoordinates = formatCoordinates;
exports.taxRegimeLabel = taxRegimeLabel;
exports.paymentMethodLabel = paymentMethodLabel;
exports.formatPaymentMethods = formatPaymentMethods;
const applyTheme_1 = require("../auth/applyTheme");
const types_1 = require("../payments/types");
exports.FISCAL_MODES = [
    {
        id: 'fiscal',
        label: 'С фискальной кассой',
        summary: 'Касса зарегистрирована в ГНС, печатаем фискальный чек с QR',
        needs: 'Нужно: ИНН, ЗН/РН ККМ, СНО, координаты',
    },
    {
        id: 'simple',
        label: 'Без фискальной кассы',
        summary: 'Только учёт товара и продаж, товарный чек без фискальных данных',
        needs: 'Нужно: название, адрес, телефон — и всё',
    },
];
exports.EDITIONS = [
    {
        id: 'start',
        label: 'Старт',
        note: 'Продажи, товары, смены и чеки. Одно рабочее место',
    },
    {
        id: 'standard',
        label: 'Стандарт',
        note: 'Дополнительно: расширенные отчёты, финансы и несколько рабочих мест',
    },
];
exports.PAYMENT_METHODS = [
    { id: 'cash', label: 'Наличные', hint: 'Всегда доступны' },
    { id: 'card', label: 'Банковская карта', hint: 'Через терминал эквайринга' },
    { id: 'qr', label: 'QR', hint: 'Оплата по QR-коду банка' },
    { id: 'nfc', label: 'NFC Pay', hint: 'Бесконтактная оплата' },
];
exports.ANALYTICS_MODES = [
    {
        id: 'revenue',
        label: 'Только продажи',
        hint: 'Главная цифра — выручка от продаж. Расходы записываются отдельно и на неё не влияют',
        suits: 'Проще, видно оборот магазина',
    },
    {
        id: 'profit',
        label: 'Выручка минус расходы',
        hint: 'Главная цифра — чистая прибыль. Закупка товара, налоги, аренда, свет, зарплата вычитаются из выручки',
        suits: 'Видно, сколько реально заработано',
    },
];
exports.TAX_REGIMES = [
    {
        id: 'simplified_single',
        label: 'Упрощённая (единый налог)',
        receiptLabel: 'Упрощённая система налогообложения на основе единого налога',
        hint: 'Торговля до 50 млн сом — 0,5%. Микробизнес до 8 млн с ККМ — 0%.',
    },
    {
        id: 'general',
        label: 'Общий режим',
        receiptLabel: 'Общий налоговый режим',
        hint: 'НДС обязателен при обороте свыше 30 млн сом в год.',
    },
    {
        id: 'patent',
        label: 'Патент',
        receiptLabel: 'Налог на основе патента',
        hint: 'Налог уплачен вперёд, в чеке ставки нулевые.',
    },
    {
        id: 'none',
        label: 'Без указания',
        receiptLabel: '',
        hint: 'Для нефискального режима.',
    },
];
/**
 * Ставки, которые подставляются при выборе режима.
 *
 * Смысл в том, чтобы человек не искал проценты в интернете: типовой набор
 * подставляется сам и остаётся редактируемым — у конкретного магазина ставки
 * могут отличаться, и спорить с ним программа не должна.
 */
exports.TAX_PRESETS = {
    // Общий режим: НДС 12%. НСП по безналу 0%, по наличным 1–2% — берём нижнюю
    // границу, точное значение владелец поправит под свой оборот.
    general: { vatRate: 12, salesTaxRate: 0, singleTaxRate: 0 },
    // Упрощённая: единый налог 0,5% для торговли, НДС и НСП нулевые.
    simplified_single: { vatRate: 0, salesTaxRate: 0, singleTaxRate: 0.5 },
    patent: { vatRate: 0, salesTaxRate: 0, singleTaxRate: 0 },
    none: { vatRate: 0, salesTaxRate: 0, singleTaxRate: 0 },
};
function taxRegimeHint(regime) {
    return exports.TAX_REGIMES.find((item) => item.id === regime)?.hint ?? '';
}
exports.LOGO_SHAPES = [
    { id: 'square', label: 'Квадрат' },
    { id: 'circle', label: 'Круг' },
];
exports.HEADER_LAYOUTS = [
    {
        id: 'combined',
        label: 'Единая картинка',
        hint: 'Один файл, где знак и надпись уже вместе',
    },
    {
        id: 'mark_left',
        label: 'Знак слева, надпись справа',
        hint: 'Два файла в строку',
    },
    {
        id: 'mark_top',
        label: 'Знак сверху, надпись снизу',
        hint: 'Два файла столбиком',
    },
    { id: 'mark', label: 'Только знак', hint: 'Надпись не нужна' },
    { id: 'wordmark', label: 'Только надпись', hint: 'Знака нет — только название' },
];
/**
 * Из чего складывается шапка при выбранной компоновке.
 *
 * Одна функция на всё приложение: по ней и шапка решает, что рисовать, и
 * редактор — какие слоты загрузки показывать. Пока это условие писалось по
 * месту, шапка и настройка расходились: редактор просил файл, который шапка
 * уже не показывала.
 */
function headerLayoutParts(layout) {
    return {
        mark: layout === 'mark' || layout === 'mark_left' || layout === 'mark_top',
        wordmark: layout === 'wordmark' || layout === 'mark_left' || layout === 'mark_top',
        combined: layout === 'combined',
        stacked: layout === 'mark_top',
    };
}
exports.LOGO_TEXT_TEMPLATES = [
    { id: 'strict', label: 'Строгий', family: 'Inter, "Segoe UI", system-ui, sans-serif', weight: 600 },
    { id: 'round', label: 'Округлый', family: 'Nunito, "Segoe UI", Verdana, sans-serif', weight: 700 },
    { id: 'classic', label: 'Классический', family: 'Georgia, "Times New Roman", serif', weight: 600 },
    {
        id: 'narrow',
        label: 'Узкий',
        family: '"Arial Narrow", "Segoe UI Semibold", "Liberation Sans Narrow", sans-serif',
        weight: 700,
    },
];
exports.ROLL_WIDTHS = [
    { id: '58', label: '58 мм · 32 символа', columns: 32 },
    { id: '80', label: '80 мм · 48 символов', columns: 48 },
];
function columnsForRoll(width) {
    return width === '80' ? 48 : 32;
}
function emptyReceiptLogoVariants() {
    return { w384: '', w288: '' };
}
/**
 * Знак, который реально уйдёт на ленту.
 *
 * Порядок отката важен: сначала вариант под текущий рулон, затем прежний
 * общий чековый вариант, и только потом экранная композиция. Иначе установки,
 * настроенные до разделения логотипов, остались бы без картинки в чеке.
 *
 * Когда у чека свой файл, экранная композиция из отката исключается: показать
 * на ленте интерфейсный логотип вместо специально загруженного — то же самое,
 * что проигнорировать загрузку.
 */
function receiptLogoSource(branding) {
    const byRoll = branding.receiptRollWidth === '58'
        ? branding.receiptLogoVariants.w288
        : branding.receiptLogoVariants.w384;
    if (byRoll)
        return byRoll;
    if (branding.receiptLogoFile)
        return '';
    return branding.logoVariants.receipt || branding.logo;
}
/** Есть ли у чека собственная картинка, не связанная с интерфейсной. */
function usesOwnReceiptLogo(branding) {
    return Boolean(branding.receiptLogoFile);
}
/**
 * Исходник для обрезки под чек.
 *
 * Именно исходник, а не уже обрезанный знак: обрезать повторно результат
 * прошлой обрезки значит терять качество на каждом заходе и не иметь
 * возможности вернуть срезанное.
 */
function receiptCropSource(branding) {
    return branding.receiptLogoFile || branding.logoMark || branding.logo;
}
function emptyLogoVariants() {
    return { s512: '', s128: '', s64: '', receipt: '' };
}
exports.PASSWORD_MIN_LENGTH = 8;
/** PIN кассира. Задаётся в разделе «Сотрудники», а не при установке. */
exports.PIN_MIN_LENGTH = 4;
exports.PIN_MAX_LENGTH = 6;
/** Пароль владельца — та же нижняя граница, что у пароля входа. */
exports.OWNER_PASSWORD_MIN_LENGTH = 8;
/** Версия формата фискальных данных, поддерживаемая этой сборкой. */
exports.FFD_VERSION = '1.0';
exports.SW_VERSION = 'NewCas-F 1.0';
exports.DEFAULT_ONBOARDING = {
    // Режим по умолчанию — простой: он ничего не требует и ничего не обещает
    // налоговой. Фискальный выбирается осознанно на первом экране мастера.
    fiscalMode: 'simple',
    // Тариф по умолчанию — «Старт»: он не обещает того, за что не платили.
    edition: 'start',
    company: { legalName: '', shortName: '', inn: '' },
    outlet: { name: '', postalCode: '', city: '', street: '', building: '', lat: '', lon: '' },
    tax: { regime: 'simplified_single', vatRate: 0, salesTaxRate: 0, singleTaxRate: 0.5 },
    kkm: {
        serialNumber: '',
        registrationNumber: '',
        fiscalModule: '',
        ffdVersion: exports.FFD_VERSION,
        swVersion: exports.SW_VERSION,
        posNumber: '1',
    },
    acquiring: {
        bank: '',
        terminalId: '',
        methods: ['cash', 'card'],
        qrProvider: '',
        secondScreen: false,
        // Статический QR включён сразу: он работает без договора с банком, и
        // магазин может принимать безнал в первый же день.
        providers: (0, types_1.defaultProviderConfigs)(),
    },
    business: {
        industry: 'other',
        currency: 'KGS',
        currencyLabel: 'сом',
        decimals: 2,
        // «Только продажи» по умолчанию: оборот понятен без объяснений, а прибыль
        // требует, чтобы расходы уже кто-то заносил.
        analyticsMode: 'revenue',
        timezone: 'Asia/Bishkek',
        country: 'Кыргызстан',
    },
    branding: {
        mode: 'monogram',
        // Заводской бренд по умолчанию: мастер не должен требовать логотип от
        // точки, которой он не нужен. Пока его не сменили, вся система выглядит
        // как продукт Kassir ERP — независимо от того, как называется магазин.
        useFactoryBrand: true,
        brandName: '',
        uiLogo: true,
        headerLayout: 'mark_left',
        logo: '',
        logoMark: '',
        logoWordmark: '',
        logoCombined: '',
        logoVariants: emptyLogoVariants(),
        logoShape: 'square',
        // Объём включён по умолчанию: эффект мягкий, работает на любом знаке, а
        // выключить его дешевле, чем не заметить, что он вообще есть.
        logoEmboss: true,
        logoTextTemplate: 'strict',
        logoTextSize: 'm',
        logoTextColor: '',
        // Стандартный акцент системы приходит из applyTheme.ts, а не пишется
        // здесь ещё раз: второй записанный дефолт однажды разойдётся с первым.
        primaryColor: applyTheme_1.DEFAULT_PRIMARY,
        theme: 'light',
        // Печать логотипа выключена по умолчанию: под заводским брендом это был бы
        // чужой знак на чеках магазина, а под своим — лишний расход ленты, пока
        // владелец сам не решит иначе.
        receiptLogo: false,
        receiptHeader: 'logo_name',
        receiptLogoFile: '',
        receiptLogoMark: '',
        receiptLogoVariants: emptyReceiptLogoVariants(),
        receiptLogoShape: 'square',
        receiptLogoStyle: 'standard',
        receiptLogoThreshold: 176,
        receiptRollWidth: '80',
        receiptFooter: '',
        touchScreen: false,
        hasCamera: false,
    },
    owner: { firstName: '', lastName: '', email: '', emailSameAsCompany: true, cashierCode: '' },
    contacts: { phone: '', email: '' },
};
/** Работает ли установка с фискальной кассой. Одна проверка на всё приложение. */
function isFiscal(data) {
    return data.fiscalMode === 'fiscal';
}
/**
 * Смена системы налогообложения: подставляет типовые ставки режима.
 *
 * Выбор СНО — это не подпись, а смена налогового контекста, поэтому ставки
 * пересчитываются целиком, а не «если пользователь их не трогал». Дальше он
 * правит их руками сколько угодно: поля остаются обычными.
 */
function applyTaxRegime(data, regime) {
    return { ...data, tax: { regime, ...exports.TAX_PRESETS[regime] } };
}
/**
 * Смена режима работы. Единственное место, где описаны его последствия.
 *
 * Простому режиму не нужны ни налоги, ни юридический email компании: чек
 * нефискальный, ставки в нём не печатаются, а связка «email владельца = email
 * компании» заперла бы пустое поле логина. Фискальные реквизиты при этом не
 * стираются — обратное переключение не должно требовать повторного ввода
 * номеров ККМ.
 */
function applyFiscalMode(data, fiscalMode) {
    if (fiscalMode === 'fiscal')
        return { ...data, fiscalMode };
    return {
        ...data,
        fiscalMode,
        tax: { regime: 'none', ...exports.TAX_PRESETS.none },
        owner: { ...data.owner, emailSameAsCompany: false },
    };
}
exports.DEFAULT_RECEIPT_FOOTER = 'Спасибо за покупку!';
/** Заголовок чека: фискальный чек его не печатает, товарный — обязан. */
exports.SIMPLE_RECEIPT_TITLE = 'ТОВАРНЫЙ ЧЕК';
/** Глубокая копия дефолтов — состояние мастера всегда начинается с неё. */
function createOnboardingDraft() {
    return structuredClone(exports.DEFAULT_ONBOARDING);
}
/**
 * Название магазина для экранов и шапки чека.
 *
 * Одно место на всё приложение и один источник — данные организации с первого
 * шага. Отдельного поля «название для шапки» нет намеренно: пока оно было,
 * магазин заводил его второй раз, оно расходилось с реквизитами, и в чеке с
 * экраном стояли разные названия.
 */
function storeDisplayName(data) {
    return (data.company.shortName.trim() ||
        data.outlet.name.trim() ||
        data.company.legalName.trim());
}
/**
 * Кегль названия в шапке приложения, в пикселях.
 *
 * Название рисуется текстом, а не картинкой, поэтому размер задаётся здесь, а
 * не долей стороны холста: на 4K-моноблоке доля от картинки давала нечитаемую
 * надпись, а тексту достаточно кегля.
 */
exports.NAME_SIZES = { s: 14, m: 17, l: 21 };
/** ФИО владельца одной строкой — так кассир печатается в чеке. */
function ownerFullName(owner) {
    return `${owner.firstName.trim()} ${owner.lastName.trim()}`.trim();
}
/**
 * Действует ли сейчас связка «email владельца совпадает с email компании».
 *
 * Двух условий, а не одного: галка стоит И режим фискальный. В простом режиме
 * юридический email компании вообще не спрашивается, поэтому связывать не с
 * чем, и галка там не показывается.
 *
 * Проверка вынесена сюда именно потому, что забыть вторую половину условия
 * легко: пока её не хватало в одном месте, поле email владельца в простом
 * режиме стиралось на каждой набранной букве — эффект зеркалил в него пустой
 * адрес компании, считая связку включённой.
 */
function isOwnerEmailLinked(data) {
    return data.fiscalMode === 'fiscal' && data.owner.emailSameAsCompany;
}
/** Email, который реально используется как логин, с учётом связки с компанией. */
function effectiveOwnerEmail(data) {
    return (isOwnerEmailLinked(data) ? data.contacts.email : data.owner.email).trim();
}
/* -------------------------------------------------------------------------- */
/* Производные значения — считаются из данных, а не хранятся отдельно          */
/* -------------------------------------------------------------------------- */
/** Адрес расчётов одной строкой: «720007, г. Бишкек, ул. Льва Толстого, 19/5». */
function formatOutletAddress(outlet) {
    const cityPart = outlet.city.trim() ? `г. ${outlet.city.trim()}` : '';
    const streetPart = [outlet.street.trim(), outlet.building.trim()].filter(Boolean).join(', ');
    return [outlet.postalCode.trim(), cityPart, streetPart].filter(Boolean).join(', ');
}
/** Координаты для чека: «42.86622, 74.56862». Пусто, если задана не вся пара. */
function formatCoordinates(outlet) {
    const lat = outlet.lat.trim();
    const lon = outlet.lon.trim();
    return lat && lon ? `${lat}, ${lon}` : '';
}
function taxRegimeLabel(regime) {
    return exports.TAX_REGIMES.find((item) => item.id === regime)?.receiptLabel ?? '';
}
function paymentMethodLabel(id) {
    return exports.PAYMENT_METHODS.find((item) => item.id === id)?.label ?? id;
}
/** Способы оплаты через запятую — строка «QR, NFC Pay, наличные» в чеке. */
function formatPaymentMethods(methods) {
    return methods.map(paymentMethodLabel).join(', ');
}
