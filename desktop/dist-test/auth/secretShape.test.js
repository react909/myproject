"use strict";
/**
 * Когда набранное уходит на проверку.
 *
 * Кнопки «Войти» в окнах нет, и это условие — единственное, что решает, войдёт
 * человек или нет. Ошибись оно в одну сторону — окно било бы в сервер обрывками
 * пароля и съедало лимит попыток; ошибись в другую — верный секрет не
 * отправился бы никогда, и окно выглядело бы зависшим.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const secretShape_1 = require("./secretShape");
const licenseKey_1 = require("./licenseKey");
const NONE = new Set();
const FULL_KEY = 'KASSIR-A1B2-C3D4-E5F6';
(0, node_test_1.test)('пароль уходит на проверку, когда набрано не меньше минимума', () => {
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('owner', 'Vladelec2026', NONE, false), true);
    // Ровно восемь — уже достаточно.
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('owner', '12345678', NONE, false), true);
});
(0, node_test_1.test)('короткий пароль не отправляется: попытка ушла бы заведомо впустую', () => {
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('owner', '1234567', NONE, false), false);
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('owner', '', NONE, false), false);
});
(0, node_test_1.test)('ключ отправляется только набранным целиком', () => {
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('specialist', FULL_KEY, NONE, false), true);
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('specialist', 'KASSIR-A1B2-C3D4-E5F', NONE, false), false);
});
(0, node_test_1.test)('уже отвергнутое сервером второй раз не отправляется', () => {
    // Иначе каждая отрисовка окна тратила бы ещё одну попытку на тот же пароль.
    const rejected = new Set(['Vladelec2026']);
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('owner', 'Vladelec2026', rejected, false), false);
    // А исправленный — отправляется.
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('owner', 'Vladelec2027', rejected, false), true);
});
(0, node_test_1.test)('пока идёт проверка, вторая не начинается', () => {
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('owner', 'Vladelec2026', NONE, true), false);
});
(0, node_test_1.test)('пробелы по краям не создают отдельного значения', () => {
    // Иначе « пароль» и «пароль » считались бы разными попытками и тратили лимит
    // по разу каждая.
    const rejected = new Set(['Vladelec2026']);
    strict_1.default.equal((0, secretShape_1.shouldAttempt)('owner', '  Vladelec2026  ', rejected, false), false);
});
(0, node_test_1.test)('известна длина — проверка без ожидания', () => {
    // Так же ведёт себя ввод кода на телефоне: длина известна, и код уходит на
    // проверку ровно на последнем символе. Именно это делает вход мгновенным.
    strict_1.default.equal((0, secretShape_1.settleMsFor)('specialist', 21), secretShape_1.KEY_SETTLE_MS);
    strict_1.default.equal((0, secretShape_1.settleMsFor)('owner', 12), 0);
});
(0, node_test_1.test)('длина неизвестна — возвращается пауза, и она не нулевая', () => {
    // Единственный оставшийся случай: касса обновилась со старой версии, длину
    // сервер узнает при первом успешном входе. Ноль здесь был бы той самой
    // ошибкой, из-за которой проверка запускалась на каждую букву.
    strict_1.default.ok(secretShape_1.PASSWORD_SETTLE_MS > 0, 'без паузы проверка запускается на каждую букву');
    strict_1.default.ok(secretShape_1.PASSWORD_SETTLE_MS <= 500, 'пауза не должна читаться как задержка');
    strict_1.default.equal((0, secretShape_1.settleMsFor)('owner', null), secretShape_1.PASSWORD_SETTLE_MS);
});
(0, node_test_1.test)('пароль отправляется ровно на своей длине, когда она известна', () => {
    // Ни раньше, ни позже: на сервере запускается ровно одна дорогая проверка.
    strict_1.default.equal((0, secretShape_1.readyToSend)('owner', 'Vladelec202', 12), false);
    strict_1.default.equal((0, secretShape_1.readyToSend)('owner', 'Vladelec2026', 12), true);
    // Перебор длины тоже не отправляется — это уже не тот пароль.
    strict_1.default.equal((0, secretShape_1.readyToSend)('owner', 'Vladelec20266', 12), false);
});
(0, node_test_1.test)('без известной длины работает прежнее правило минимума', () => {
    strict_1.default.equal((0, secretShape_1.readyToSend)('owner', '1234567', null), false);
    strict_1.default.equal((0, secretShape_1.readyToSend)('owner', '12345678', null), true);
});
(0, node_test_1.test)('длина ключа известна всегда — её не надо спрашивать у сервера', () => {
    strict_1.default.equal((0, secretShape_1.expectedLengthFor)('specialist', null), licenseKey_1.LICENSE_KEY_LENGTH);
    // А у пароля — только то, что сообщил сервер.
    strict_1.default.equal((0, secretShape_1.expectedLengthFor)('owner', null), null);
    strict_1.default.equal((0, secretShape_1.expectedLengthFor)('owner', 12), 12);
});
(0, node_test_1.test)('маска и вид поля по-прежнему различаются у ключа и пароля', () => {
    strict_1.default.equal((0, secretShape_1.shapeFor)('owner').mask('Па Роль-1'), 'Па Роль-1');
    strict_1.default.equal((0, secretShape_1.shapeFor)('specialist').mask('a1b2c3d4e5f6'), FULL_KEY);
});
