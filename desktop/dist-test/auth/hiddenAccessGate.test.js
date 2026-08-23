"use strict";
/**
 * Двухступенчатый вход специалиста.
 *
 * Проверяется главное свойство: без аккорда удержание логотипа не делает
 * ничего. Пока жест работал сам по себе, его находил любой любопытный кассир —
 * логотип на виду, а удержание первое, что пробуют на сенсорном экране.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const hiddenAccessGate_1 = require("./hiddenAccessGate");
const HOLD_MS = 5000;
/** Прогоняет серию тапов с заданными паузами и отдаёт итог. */
function tapSeries(gaps) {
    let now = 1_000;
    let taps = (0, hiddenAccessGate_1.registerTap)([], now);
    for (const gap of gaps) {
        now += gap;
        taps = (0, hiddenAccessGate_1.registerTap)(taps, now);
    }
    return { taps, armed: (0, hiddenAccessGate_1.tapsArm)(taps) };
}
(0, node_test_1.test)('без аккорда не работает ничего: ни тапы, ни удержание', () => {
    const state = (0, hiddenAccessGate_1.createGateState)();
    strict_1.default.equal((0, hiddenAccessGate_1.isArmed)(state, 1_000), false);
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(state, 1_000), false);
    // Тапы без разрешения не дают права на удержание, сколько бы их ни было.
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)((0, hiddenAccessGate_1.completeTaps)(state, 1_000), 1_000), false);
    // И удержание не начинается никогда — отсчёта нет, показывать нечего.
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(state, 1_000_000), false);
});
(0, node_test_1.test)('аккорд выдаёт разрешение на полминуты — но только на тапы', () => {
    const now = 10_000;
    const state = (0, hiddenAccessGate_1.arm)((0, hiddenAccessGate_1.createGateState)(), now);
    strict_1.default.equal((0, hiddenAccessGate_1.isArmed)(state, now), true);
    strict_1.default.equal((0, hiddenAccessGate_1.isArmed)(state, now + hiddenAccessGate_1.ARM_WINDOW_MS - 1), true);
    // Ровно в момент истечения разрешение уже погасло.
    strict_1.default.equal((0, hiddenAccessGate_1.isArmed)(state, now + hiddenAccessGate_1.ARM_WINDOW_MS), false);
    // Само по себе разрешение удержание не открывает — нужно второе звено.
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(state, now), false);
});
(0, node_test_1.test)('цепочка целиком: аккорд, тапы, удержание', () => {
    const chord = 10_000;
    const taps = chord + 5_000;
    const state = (0, hiddenAccessGate_1.completeTaps)((0, hiddenAccessGate_1.arm)((0, hiddenAccessGate_1.createGateState)(), chord), taps);
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(state, taps), true);
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(state, taps + hiddenAccessGate_1.HOLD_WINDOW_MS - 1), true);
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(state, taps + hiddenAccessGate_1.HOLD_WINDOW_MS), false);
});
(0, node_test_1.test)('серия тапов тратит разрешение: второй раз подряд не пройти', () => {
    const chord = 10_000;
    const after = (0, hiddenAccessGate_1.completeTaps)((0, hiddenAccessGate_1.arm)((0, hiddenAccessGate_1.createGateState)(), chord), chord + 1_000);
    strict_1.default.equal((0, hiddenAccessGate_1.isArmed)(after, chord + 1_000), false);
    // Повторная серия без нового аккорда ничего не продлевает.
    const again = (0, hiddenAccessGate_1.completeTaps)(after, chord + 2_000);
    strict_1.default.equal(again.holdUntil, after.holdUntil);
});
(0, node_test_1.test)('тапы после истечения разрешения не считаются', () => {
    const chord = 10_000;
    const late = chord + hiddenAccessGate_1.ARM_WINDOW_MS + 1;
    const state = (0, hiddenAccessGate_1.completeTaps)((0, hiddenAccessGate_1.arm)((0, hiddenAccessGate_1.createGateState)(), chord), late);
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(state, late), false);
});
(0, node_test_1.test)('цепочка одноразовая: после сброса нужен новый аккорд', () => {
    const passed = (0, hiddenAccessGate_1.completeTaps)((0, hiddenAccessGate_1.arm)((0, hiddenAccessGate_1.createGateState)(), 0), 1_000);
    const after = (0, hiddenAccessGate_1.disarm)();
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(after, 2_000), false);
    strict_1.default.equal((0, hiddenAccessGate_1.isArmed)(after, 2_000), false);
    // Прежнее состояние на это не влияет — сброс полный.
    strict_1.default.notEqual(passed.holdUntil, after.holdUntil);
});
(0, node_test_1.test)('повторный аккорд начинает цепочку заново, а не продолжает её', () => {
    const passed = (0, hiddenAccessGate_1.completeTaps)((0, hiddenAccessGate_1.arm)((0, hiddenAccessGate_1.createGateState)(), 0), 1_000);
    const restarted = (0, hiddenAccessGate_1.arm)(passed, 2_000);
    // Право на удержание сгорело: аккорд возвращает к первому звену.
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(restarted, 2_000), false);
    strict_1.default.equal((0, hiddenAccessGate_1.isArmed)(restarted, 2_000), true);
});
(0, node_test_1.test)('окно ключа открывается ровно на пятой секунде', () => {
    strict_1.default.equal((0, hiddenAccessGate_1.holdCompleted)(0, 4_999, HOLD_MS), false);
    strict_1.default.equal((0, hiddenAccessGate_1.holdCompleted)(0, 5_000, HOLD_MS), true);
});
(0, node_test_1.test)('намёк появляется на третьей секунде, не раньше', () => {
    // Первые три секунды — ничего: случайное касание ничего не выдаёт.
    strict_1.default.equal((0, hiddenAccessGate_1.showsHint)((0, hiddenAccessGate_1.holdProgress)(0, 1_000, HOLD_MS)), false);
    strict_1.default.equal((0, hiddenAccessGate_1.showsHint)((0, hiddenAccessGate_1.holdProgress)(0, 2_999, HOLD_MS)), false);
    strict_1.default.equal((0, hiddenAccessGate_1.showsHint)((0, hiddenAccessGate_1.holdProgress)(0, 3_000, HOLD_MS)), true);
    strict_1.default.equal((0, hiddenAccessGate_1.showsHint)((0, hiddenAccessGate_1.holdProgress)(0, 4_500, HOLD_MS)), true);
    // Порог соответствует трём секундам из пяти.
    strict_1.default.equal(hiddenAccessGate_1.HOLD_HINT_FROM * HOLD_MS, 3_000);
});
(0, node_test_1.test)('доля удержания не выходит за границы', () => {
    strict_1.default.equal((0, hiddenAccessGate_1.holdProgress)(0, -100, HOLD_MS), 0);
    strict_1.default.equal((0, hiddenAccessGate_1.holdProgress)(0, 99_999, HOLD_MS), 1);
});
/* --- Второе звено: серия тапов по логотипу -------------------------------- */
(0, node_test_1.test)('пять быстрых тапов складываются в серию', () => {
    // Четыре паузы по 300 мс — вся серия укладывается в секунду с небольшим.
    const { armed, taps } = tapSeries([300, 300, 300, 300]);
    strict_1.default.equal(taps.length, hiddenAccessGate_1.TAP_COUNT);
    strict_1.default.equal(armed, true);
});
(0, node_test_1.test)('четырёх тапов недостаточно', () => {
    strict_1.default.equal(tapSeries([300, 300, 300]).armed, false);
});
(0, node_test_1.test)('пауза посередине обнуляет счётчик', () => {
    // Два тапа, пауза четыре секунды, ещё три: серия начинается заново, и до
    // пяти она не доходит.
    const { armed, taps } = tapSeries([300, 4_000, 300, 300]);
    strict_1.default.equal(armed, false);
    strict_1.default.equal(taps.length, 3);
});
(0, node_test_1.test)('пять медленных тапов не считаются серией', () => {
    // Паузы короче окна, поэтому счётчик не обнуляется, но вся серия длиннее
    // трёх секунд — так по логотипу попадают случайно, а не жестом.
    const { armed, taps } = tapSeries([900, 900, 900, 900]);
    strict_1.default.equal(taps.length, hiddenAccessGate_1.TAP_COUNT);
    strict_1.default.equal(armed, false);
});
(0, node_test_1.test)('серия на самой границе окна ещё считается', () => {
    const { armed } = tapSeries([hiddenAccessGate_1.TAP_WINDOW_MS / 4, hiddenAccessGate_1.TAP_WINDOW_MS / 4, hiddenAccessGate_1.TAP_WINDOW_MS / 4, hiddenAccessGate_1.TAP_WINDOW_MS / 4]);
    strict_1.default.equal(armed, true);
});
(0, node_test_1.test)('серия сама по себе — не вход: без аккорда она ничего не открывает', () => {
    // Ровно тот случай, ради которого цепочка и делалась: кассир, отбивающий
    // пальцем по логотипу, набирает серию и не получает ничего.
    const { armed } = tapSeries([300, 300, 300, 300]);
    strict_1.default.equal(armed, true, 'серия набрана');
    const state = (0, hiddenAccessGate_1.completeTaps)((0, hiddenAccessGate_1.createGateState)(), 50_000);
    strict_1.default.equal((0, hiddenAccessGate_1.shouldStartHold)(state, 50_000), false);
});
