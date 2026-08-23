"use strict";
/**
 * Аккорд специалиста: `Ctrl+Alt+Shift` и обе стрелки.
 *
 * Проверяется главное: аккорд не срабатывает ни от одной стрелки, ни без
 * какого-либо из трёх модификаторов. Каждая такая поблажка превращала бы
 * первое звено цепочки в сочетание, которое можно нажать случайно локтем или
 * подсмотреть из-за плеча по половине.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const hiddenAccess_1 = require("./hiddenAccess");
/** Событие клавиатуры в объёме, который нужен проверке аккорда. */
function keys(ctrl, alt, shift) {
    return { ctrlKey: ctrl, altKey: alt, shiftKey: shift };
}
const ALL_MODIFIERS = keys(true, true, true);
const BOTH_ARROWS = new Set(['ArrowLeft', 'ArrowRight']);
(0, node_test_1.test)('три модификатора и обе стрелки — аккорд сработал', () => {
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(ALL_MODIFIERS, BOTH_ARROWS), true);
});
(0, node_test_1.test)('порядок стрелок не важен: важно, что зажаты обе', () => {
    // Набор неупорядочен по определению — тест фиксирует, что реализация не
    // начнёт однажды требовать «сначала влево».
    const reversed = new Set(['ArrowRight', 'ArrowLeft']);
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(ALL_MODIFIERS, reversed), true);
});
(0, node_test_1.test)('одной стрелки мало', () => {
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(ALL_MODIFIERS, new Set(['ArrowLeft'])), false);
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(ALL_MODIFIERS, new Set(['ArrowRight'])), false);
});
(0, node_test_1.test)('без любого из трёх модификаторов аккорда нет', () => {
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(keys(false, true, true), BOTH_ARROWS), false);
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(keys(true, false, true), BOTH_ARROWS), false);
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(keys(true, true, false), BOTH_ARROWS), false);
});
(0, node_test_1.test)('стрелок нет вовсе — модификаторы сами по себе ничего не значат', () => {
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(ALL_MODIFIERS, new Set()), false);
});
/* --- Стрелки можно нажимать по очереди ------------------------------------ */
/** Отметки «когда нажата», как их ведёт useHiddenAccess. */
function at(left, right) {
    const map = new Map();
    if (left !== null)
        map.set('ArrowLeft', left);
    if (right !== null)
        map.set('ArrowRight', right);
    return map;
}
(0, node_test_1.test)('стрелки, нажатые подряд, засчитываются за аккорд', () => {
    // Требовать физической одновременности оказалось слишком строго: с зажатыми
    // тремя модификаторами стрелки жмут по очереди, и первую успевают отпустить.
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChordWithin)(ALL_MODIFIERS, at(1000, 1400), 1400), true);
});
(0, node_test_1.test)('слишком долгий разрыв между стрелками аккордом не считается', () => {
    const late = 1000 + hiddenAccess_1.CHORD_WINDOW_MS + 1;
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChordWithin)(ALL_MODIFIERS, at(1000, late), late), false);
});
(0, node_test_1.test)('одной стрелки не хватает и по времени', () => {
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChordWithin)(ALL_MODIFIERS, at(1000, null), 1100), false);
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChordWithin)(ALL_MODIFIERS, at(null, 1000), 1100), false);
});
(0, node_test_1.test)('без модификаторов время стрелок ничего не значит', () => {
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChordWithin)(keys(false, true, true), at(1000, 1100), 1100), false);
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChordWithin)(keys(true, false, true), at(1000, 1100), 1100), false);
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChordWithin)(keys(true, true, false), at(1000, 1100), 1100), false);
});
(0, node_test_1.test)('лишние зажатые клавиши аккорду не мешают', () => {
    // Стрелки нажимают, не отпуская модификаторов, и клавиатура нередко успевает
    // прислать что-то ещё. Требовать «ровно две клавиши» значило бы ломать
    // аккорд на ровном месте.
    const noisy = new Set(['ArrowLeft', 'ArrowRight', 'Shift', 'Control']);
    strict_1.default.equal((0, hiddenAccess_1.matchesSpecialistChord)(ALL_MODIFIERS, noisy), true);
});
(0, node_test_1.test)('аккорд владельца остаётся обычным сочетанием', () => {
    strict_1.default.equal((0, hiddenAccess_1.normalizeShortcut)(hiddenAccess_1.DEFAULT_HIDDEN_ACCESS.owner), 'ctrl+shift+m');
});
(0, node_test_1.test)('аккорд владельца не срабатывает от аккорда специалиста', () => {
    // Оба живут в одном обработчике, и перепутать двери нельзя: у владельца
    // окно открывается сразу, у специалиста — только взводится ожидание.
    const event = {
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        code: 'ArrowLeft',
    };
    strict_1.default.equal((0, hiddenAccess_1.matchesShortcut)(event, hiddenAccess_1.DEFAULT_HIDDEN_ACCESS.owner), false);
});
(0, node_test_1.test)('пароль владельца и ключ специалиста открывают разные двери', () => {
    // Сочетания разные и настраиваются раздельно — общего аккорда на обе двери
    // нет и быть не должно.
    strict_1.default.notEqual((0, hiddenAccess_1.normalizeShortcut)(hiddenAccess_1.DEFAULT_HIDDEN_ACCESS.owner), (0, hiddenAccess_1.normalizeShortcut)(hiddenAccess_1.DEFAULT_HIDDEN_ACCESS.specialist));
});
