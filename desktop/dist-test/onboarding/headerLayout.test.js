"use strict";
/**
 * Состав шапки приложения по выбранной компоновке.
 *
 * Проверяется то, на чём эта часть ломается: шапка и редактор спрашивают состав
 * у одной функции, и стоит ей разойтись с настройкой — редактор просит файл,
 * который шапка уже не показывает, или наоборот. Отсюда и главный инвариант
 * ниже: единая картинка не соседствует ни со знаком, ни с надписью.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const types_1 = require("./types");
const ALL = types_1.HEADER_LAYOUTS.map((item) => item.id);
(0, node_test_1.test)('единая картинка заменяет собой знак и надпись, а не дополняет их', () => {
    const parts = (0, types_1.headerLayoutParts)('combined');
    strict_1.default.equal(parts.combined, true);
    strict_1.default.equal(parts.mark, false);
    strict_1.default.equal(parts.wordmark, false);
});
(0, node_test_1.test)('две картинки — только у строки и столбика', () => {
    for (const layout of ALL) {
        const parts = (0, types_1.headerLayoutParts)(layout);
        const both = parts.mark && parts.wordmark;
        strict_1.default.equal(both, layout === 'mark_left' || layout === 'mark_top', layout);
    }
});
(0, node_test_1.test)('столбиком стоит только «знак сверху, надпись снизу»', () => {
    for (const layout of ALL) {
        strict_1.default.equal((0, types_1.headerLayoutParts)(layout).stacked, layout === 'mark_top', layout);
    }
});
(0, node_test_1.test)('одиночные компоновки просят ровно одну картинку', () => {
    const mark = (0, types_1.headerLayoutParts)('mark');
    strict_1.default.deepEqual([mark.mark, mark.wordmark, mark.combined], [true, false, false]);
    const wordmark = (0, types_1.headerLayoutParts)('wordmark');
    strict_1.default.deepEqual([wordmark.mark, wordmark.wordmark, wordmark.combined], [false, true, false]);
});
(0, node_test_1.test)('пустых компоновок нет: шапка не может остаться без бренда вовсе', () => {
    for (const layout of ALL) {
        const parts = (0, types_1.headerLayoutParts)(layout);
        strict_1.default.ok(parts.mark || parts.wordmark || parts.combined, layout);
    }
});
(0, node_test_1.test)('по умолчанию — знак слева, надпись справа: так шапка выглядела и раньше', () => {
    strict_1.default.equal(types_1.DEFAULT_ONBOARDING.branding.headerLayout, 'mark_left');
    // Картинок нет ни у знака, ни у надписи: пока их не загрузили, шапка рисует
    // название текстом из реквизитов.
    strict_1.default.equal(types_1.DEFAULT_ONBOARDING.branding.logoWordmark, '');
    strict_1.default.equal(types_1.DEFAULT_ONBOARDING.branding.logoCombined, '');
});
