"use strict";
/**
 * Читаемость акцента: то единственное в этой системе, что нельзя проверить
 * глазами.
 *
 * Цвет выбирает клиент, и выбрать он может любой из шестнадцати миллионов.
 * Посмотреть на все нельзя, а достаточно одного неудачного — и кассир полдня
 * не видит надписи на кнопке «Оплатить». Поэтому проверяется не «выглядит
 * хорошо», а измеримое: контраст по WCAG не ниже 4.5:1, и не для десятка
 * подобранных цветов, а для всей сетки оттенков разом.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const applyTheme_1 = require("./applyTheme");
const SURFACE_LIGHT = '#ffffff';
const SURFACE_DARK = '#151b23';
const SURFACE_RAIL = '#10151d';
/** Сетка по всему цветовому кубу: 6×6×6 = 216 цветов, включая крайности. */
function colorGrid() {
    const steps = [0, 51, 102, 153, 204, 255];
    const hex = (n) => n.toString(16).padStart(2, '0');
    const out = [];
    for (const r of steps)
        for (const g of steps)
            for (const b of steps) {
                out.push(`#${hex(r)}${hex(g)}${hex(b)}`);
            }
    return out;
}
(0, node_test_1.test)('текст на кнопке читается при любом акценте', () => {
    for (const accent of colorGrid()) {
        const fg = (0, applyTheme_1.readableTextOn)(accent);
        const ratio = (0, applyTheme_1.contrastRatio)(fg, accent);
        strict_1.default.ok(ratio >= applyTheme_1.MIN_TEXT_CONTRAST, `${accent}: текст ${fg} даёт ${ratio.toFixed(2)}:1, нужно ${applyTheme_1.MIN_TEXT_CONTRAST}`);
    }
});
(0, node_test_1.test)('на стандартном мятном текст тёмный, а не белый', () => {
    // Та самая ошибка, ради которой всё считается: белая надпись на #00f5bc
    // даёт 1.4:1 и не видна вовсе.
    strict_1.default.equal((0, applyTheme_1.readableTextOn)(applyTheme_1.DEFAULT_PRIMARY), '#000000');
    strict_1.default.ok((0, applyTheme_1.contrastRatio)('#ffffff', applyTheme_1.DEFAULT_PRIMARY) < applyTheme_1.MIN_TEXT_CONTRAST);
});
(0, node_test_1.test)('на тёмном акценте текст светлый', () => {
    strict_1.default.equal((0, applyTheme_1.readableTextOn)('#0f172a'), '#ffffff');
    strict_1.default.equal((0, applyTheme_1.readableTextOn)('#4f46e5'), '#ffffff');
});
(0, node_test_1.test)('акцент как цвет надписи читается на всех трёх поверхностях', () => {
    for (const accent of colorGrid()) {
        for (const surface of [SURFACE_LIGHT, SURFACE_DARK, SURFACE_RAIL]) {
            const text = (0, applyTheme_1.accentTextOn)(accent, surface);
            const ratio = (0, applyTheme_1.contrastRatio)(text, surface);
            strict_1.default.ok(ratio >= applyTheme_1.MIN_TEXT_CONTRAST, `${accent} на ${surface}: получилось ${text}, ${ratio.toFixed(2)}:1`);
        }
    }
});
(0, node_test_1.test)('усиленный вариант надписи добирает до 7:1', () => {
    for (const accent of colorGrid()) {
        const strong = (0, applyTheme_1.accentTextOn)(accent, SURFACE_LIGHT, 7);
        strict_1.default.ok((0, applyTheme_1.contrastRatio)(strong, SURFACE_LIGHT) >= 7, `${accent}: усиленный ${strong} не дотянул до 7:1`);
    }
});
(0, node_test_1.test)('акцент, годный как есть, не перекрашивается', () => {
    // Тёмно-синий и так читается на белом — трогать его незачем, иначе оттенок
    // фирменного цвета уплывал бы без причины.
    strict_1.default.equal((0, applyTheme_1.accentTextOn)('#2563eb', SURFACE_LIGHT), '#2563eb');
});
(0, node_test_1.test)('стандартный цвет системы проходит проверку на обеих темах', () => {
    strict_1.default.equal((0, applyTheme_1.accentProblem)(applyTheme_1.DEFAULT_PRIMARY, 'light'), '');
    strict_1.default.equal((0, applyTheme_1.accentProblem)(applyTheme_1.DEFAULT_PRIMARY, 'dark'), '');
    strict_1.default.equal((0, applyTheme_1.accentOtherThemeWarning)(applyTheme_1.DEFAULT_PRIMARY, 'light'), '');
});
(0, node_test_1.test)('цвет, сливающийся с фоном, не пропускается', () => {
    // Белый на светлой теме и почти-чёрный на тёмной — кнопок не будет видно.
    strict_1.default.notEqual((0, applyTheme_1.accentProblem)('#ffffff', 'light'), '');
    strict_1.default.notEqual((0, applyTheme_1.accentProblem)('#fafafa', 'light'), '');
    strict_1.default.notEqual((0, applyTheme_1.accentProblem)('#0b0e13', 'dark'), '');
    strict_1.default.notEqual((0, applyTheme_1.accentProblem)('#151b23', 'dark'), '');
});
(0, node_test_1.test)('негодный на одной теме бывает годен на другой', () => {
    // Запрещать такой цвет вообще нельзя: магазин со светлой темой в тёмную
    // может не зайти никогда. Отказ — по текущей теме, предупреждение — о второй.
    strict_1.default.equal((0, applyTheme_1.accentProblem)('#ffffff', 'dark'), '');
    strict_1.default.notEqual((0, applyTheme_1.accentOtherThemeWarning)('#ffffff', 'dark'), '');
    strict_1.default.equal((0, applyTheme_1.accentProblem)('#0f172a', 'light'), '');
    strict_1.default.notEqual((0, applyTheme_1.accentOtherThemeWarning)('#0f172a', 'light'), '');
});
(0, node_test_1.test)('недобранный хекс не проходит', () => {
    strict_1.default.notEqual((0, applyTheme_1.accentProblem)('#00f5b', 'light'), '');
    strict_1.default.notEqual((0, applyTheme_1.accentProblem)('', 'light'), '');
});
(0, node_test_1.test)('готовые варианты палитры работают на обеих темах', () => {
    // Список повторяет ACCENT_PRESETS из BrandEditor.tsx. Ради него проверка и
    // существует: предлагать в один клик цвет, который сам же и забракуешь при
    // сохранении, — худшее, что может сделать этот экран.
    const presets = ['#00f5bc', '#4f46e5', '#2563eb', '#0f9d58', '#e2761b', '#d0342c', '#7c3aed', '#475569'];
    for (const hex of presets) {
        strict_1.default.equal((0, applyTheme_1.accentProblem)(hex, 'light'), '', `${hex} не годится на светлой теме`);
        strict_1.default.equal((0, applyTheme_1.accentProblem)(hex, 'dark'), '', `${hex} не годится на тёмной теме`);
    }
});
(0, node_test_1.test)('разбор хекса', () => {
    strict_1.default.ok((0, applyTheme_1.isValidHex)('#00F5BC'));
    strict_1.default.ok(!(0, applyTheme_1.isValidHex)('00f5bc'));
    strict_1.default.ok(!(0, applyTheme_1.isValidHex)('#00f5b'));
    strict_1.default.equal((0, applyTheme_1.normalizeHex)('#00F5BC'), '#00f5bc');
    // Мусор на входе — стандартный цвет, а не сломанная тема.
    strict_1.default.equal((0, applyTheme_1.normalizeHex)('не цвет'), applyTheme_1.DEFAULT_PRIMARY);
    strict_1.default.equal((0, applyTheme_1.sanitizeHexInput)('00f5bcZZ'), '#00f5bc');
    strict_1.default.equal((0, applyTheme_1.sanitizeHexInput)('#00f5bcffff'), '#00f5bc');
});
