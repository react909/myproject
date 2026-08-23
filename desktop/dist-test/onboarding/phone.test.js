"use strict";
/**
 * Маска телефона.
 *
 * Проверяется то, на чём она ломалась в жизни: поле дописывало цифры само,
 * принимало больше девяти и теряло код страны. Вставка из буфера в разных
 * видах — отдельный случай: номер приносят из мессенджера, из визитки и из
 * банковского приложения, и все три вида должны сойтись к одному.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const phone_1 = require("./phone");
(0, node_test_1.test)('вставка из буфера приводится к одному виду', () => {
    for (const raw of [
        '0555123456',
        '996555123456',
        '+996 555 12-34-56',
        '+996555123456',
        '555 123 456',
        '(0555) 12 34 56',
    ]) {
        strict_1.default.equal((0, phone_1.phoneValue)(raw), '+996555123456', `вставка «${raw}»`);
    }
});
(0, node_test_1.test)('больше девяти цифр после кода не принимается', () => {
    strict_1.default.equal((0, phone_1.phoneDigits)('9965551234567890'), '555123456');
    strict_1.default.equal((0, phone_1.phoneValue)('+996 555 123 456 789'), '+996555123456');
    strict_1.default.equal((0, phone_1.phoneDigits)('5551234567').length, phone_1.PHONE_NATIONAL_LENGTH);
});
(0, node_test_1.test)('приложение не дописывает цифры от себя', () => {
    // Ровно то, что набрали, — ни одной лишней цифры, только пробелы.
    strict_1.default.equal((0, phone_1.formatPhoneInput)('+996555'), '+996 555');
    strict_1.default.equal((0, phone_1.formatPhoneInput)('+9965551'), '+996 555 1');
    strict_1.default.equal((0, phone_1.phoneDigits)('555'), '555');
    // Пустое поле — только код страны, без единой цифры номера.
    strict_1.default.equal((0, phone_1.formatPhoneInput)(''), '+996 ');
    strict_1.default.equal((0, phone_1.phoneDigits)(''), '');
});
(0, node_test_1.test)('номер, начинающийся на 996, не принимают за код страны дважды', () => {
    strict_1.default.equal((0, phone_1.phoneValue)('996123456'), '+996996123456');
});
(0, node_test_1.test)('форматирование для поля и для чека', () => {
    strict_1.default.equal((0, phone_1.formatPhoneInput)('+996555123456'), '+996 555 123 456');
    strict_1.default.equal((0, phone_1.formatPhone)('+996555123456'), '+996 555 123 456');
    // Пустой номер в чеке — пустая строка, а не голый код страны: строка
    // «Телефон: +996» на чеке выглядит как ошибка кассы.
    strict_1.default.equal((0, phone_1.formatPhone)(''), '');
    // Номера, сохранённые прежней маской с пробелами, читаются как есть.
    strict_1.default.equal((0, phone_1.formatPhone)('+996 555 111 222'), '+996 555 111 222');
});
(0, node_test_1.test)('неполный номер не пускает дальше', () => {
    strict_1.default.equal((0, phone_1.phoneProblem)('+996555'), 'Введите 9 цифр после +996.');
    strict_1.default.equal((0, phone_1.phoneProblem)('+996555123456'), '');
    // Пустое поле — забота обязательности поля, а не маски.
    strict_1.default.equal((0, phone_1.phoneProblem)(''), '');
});
(0, node_test_1.test)('курсор встаёт после набранной цифры, а не в конец строки', () => {
    strict_1.default.equal((0, phone_1.caretAfterDigits)(0), '+996 '.length);
    strict_1.default.equal((0, phone_1.caretAfterDigits)(3), '+996 555'.length);
    strict_1.default.equal((0, phone_1.caretAfterDigits)(4), '+996 555 1'.length);
    strict_1.default.equal((0, phone_1.caretAfterDigits)(9), (0, phone_1.formatPhoneInput)('+996555123456').length);
});
