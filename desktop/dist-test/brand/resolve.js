"use strict";
/**
 * Решения о бренде — без картинок.
 *
 * Отдельный модуль от brand.ts по одной причине: там импортируется PNG знака,
 * а сборка тестов идёт в CommonJS через node --test, где `require` картинки
 * разрешать нечем. Решения при этом и есть то, что стоит проверять: какое имя
 * попадёт в шапку и какой цвет применится при каждом режиме. Знак к ним ничего
 * не добавляет — он один и тот же файл.
 *
 * Граница, ради которой всё это заведено:
 *
 *   данные магазина (шаг 1) → реквизиты, чек, документы;
 *   бренд интерфейса (шаг 4) → шапка, экраны входа, цвет всей системы.
 *
 * Пока границы не было, шапка брала название торговой точки из реквизитов.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FACTORY_THEME = exports.FACTORY_ACCENT = exports.FACTORY_NAME = void 0;
exports.resolveBrandName = resolveBrandName;
exports.brandTheme = brandTheme;
const applyTheme_1 = require("../auth/applyTheme");
/** Заводское название системы. */
exports.FACTORY_NAME = 'Kassir ERP';
/** Заводской акцент. Тот же, что стоит в styles/tokens.css и в базе. */
exports.FACTORY_ACCENT = applyTheme_1.DEFAULT_PRIMARY;
/** Заводская тема. */
exports.FACTORY_THEME = 'light';
/**
 * Название системы в интерфейсе.
 *
 * Пустое название под своим брендом — всё ещё «Kassir ERP»: безымянная шапка
 * хуже заводской, а поле клиент вполне может оставить незаполненным, загрузив
 * один только знак.
 */
function resolveBrandName(branding) {
    if (branding.useFactoryBrand)
        return exports.FACTORY_NAME;
    return branding.brandName.trim() || exports.FACTORY_NAME;
}
/**
 * Тема и акцент, которые надо применить.
 *
 * Разница видна ровно в одном случае, и он и есть смысл функции: под заводским
 * брендом система стоит в мятном, даже если в `primaryColor` лежит цвет,
 * который клиент выбирал в прошлый заход и потом вернулся к Kassir ERP.
 * Сохранённое значение при этом не стирается — переключиться обратно можно
 * одним нажатием, и цвет окажется на месте.
 */
function brandTheme(branding) {
    if (branding.useFactoryBrand)
        return { mode: exports.FACTORY_THEME, primary: exports.FACTORY_ACCENT };
    return { mode: branding.theme, primary: branding.primaryColor };
}
