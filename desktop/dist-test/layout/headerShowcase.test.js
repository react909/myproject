"use strict";
/**
 * Предохранитель от вечной перерисовки шапки.
 *
 * Касса публикует свои числа в общую шапку, шапка держит их в состоянии
 * каркаса. Если публикация с теми же числами каждый раз считалась бы новой,
 * получился бы замкнутый круг: состояние каркаса меняется, каркас
 * перерисовывает кассу, касса публикует снова. На кассе это зависание посреди
 * продажи, поэтому сравнение проверяется отдельно от React.
 *
 * Обработчик кнопки в сравнение не входит намеренно: он приезжает новой
 * функцией на каждой отрисовке, и по нему круг не разорвать никогда — он живёт
 * в ссылке, а шапке уходит стабильная обёртка.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const headerShowcase_1 = require("./headerShowcase");
function showcase(patch = {}) {
    return {
        scaleEnabled: true,
        scaleDisplayKg: 1.234,
        scaleWeightStable: false,
        onFixScaleWeight: () => { },
        totalRub: 250,
        salesCount: 3,
        shiftOpen: true,
        shiftRevenue: 4200,
        ...patch,
    };
}
(0, node_test_1.test)('те же числа в новом объекте — это одно и то же', () => {
    strict_1.default.equal((0, headerShowcase_1.showcaseNumbersEqual)(showcase(), showcase()), true);
});
(0, node_test_1.test)('новый обработчик сам по себе не считается изменением', () => {
    const before = showcase({ onFixScaleWeight: () => { } });
    const after = showcase({ onFixScaleWeight: () => { } });
    strict_1.default.equal((0, headerShowcase_1.showcaseNumbersEqual)(before, after), true);
});
(0, node_test_1.test)('изменение любого числа замечается', () => {
    const cases = [
        { scaleEnabled: false },
        { scaleDisplayKg: 1.235 },
        { scaleDisplayKg: null },
        { scaleWeightStable: true },
        { totalRub: 251 },
        { salesCount: 4 },
        { shiftOpen: false },
        { shiftRevenue: 4201 },
    ];
    for (const patch of cases) {
        strict_1.default.equal((0, headerShowcase_1.showcaseNumbersEqual)(showcase(), showcase(patch)), false, JSON.stringify(patch));
    }
});
(0, node_test_1.test)('уход со страницы и возврат на неё — это изменение', () => {
    strict_1.default.equal((0, headerShowcase_1.showcaseNumbersEqual)(showcase(), null), false);
    strict_1.default.equal((0, headerShowcase_1.showcaseNumbersEqual)(null, showcase()), false);
    // Обе пустые — на соседней странице чисел кассы нет, и повторная очистка
    // не должна дёргать шапку.
    strict_1.default.equal((0, headerShowcase_1.showcaseNumbersEqual)(null, null), true);
});
