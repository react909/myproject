"use strict";
/**
 * Маска лицензионного ключа и признак «набран целиком».
 *
 * От второго зависит автоматический вход в окне специалиста: по нему ключ
 * уходит на проверку без кнопки. Ошибись он в одну сторону — окно било бы в
 * сервер недобранным ключом на каждый символ и съедало лимит попыток; ошибись
 * в другую — ключ, набранный правильно, не отправился бы никогда, и человек
 * упирался бы в молчание.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const licenseKey_1 = require("./licenseKey");
const FULL = 'KASSIR-A1B2-C3D4-E5F6';
(0, node_test_1.test)('ключ разбивается на группы по мере набора', () => {
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('A1B2'), 'KASSIR-A1B2');
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('A1B2C3D4'), 'KASSIR-A1B2-C3D4');
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('A1B2C3D4E5F6'), FULL);
});
(0, node_test_1.test)('пустой ввод не превращается в один префикс', () => {
    // Иначе очистка поля оставляла бы «KASSIR-», и стереть его было бы нечем.
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)(''), '');
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('KASSIR'), '');
});
(0, node_test_1.test)('набранный вручную префикс не задваивается', () => {
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('KASSIR-A1B2-C3D4-E5F6'), FULL);
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('kassira1b2c3d4e5f6'), FULL);
});
(0, node_test_1.test)('регистр, пробелы и дефисы человек расставляет как хочет', () => {
    // Ключ читают с наклейки и набирают на экранной клавиатуре — придираться к
    // тому, как он разделил группы, здесь не к чему.
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('a1b2 c3d4 e5f6'), FULL);
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('a1b2--c3d4---e5f6'), FULL);
});
(0, node_test_1.test)('лишнее за пределами длины ключа отбрасывается', () => {
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('A1B2C3D4E5F6ZZZZ'), FULL);
    strict_1.default.equal(FULL.length, licenseKey_1.LICENSE_KEY_LENGTH);
});
(0, node_test_1.test)('готовым ключ считается только целиком', () => {
    strict_1.default.equal((0, licenseKey_1.isCompleteLicenseKey)(FULL), true);
    // Одиннадцать символов из двенадцати — ещё не ключ: отправлять его значит
    // потратить попытку заведомо впустую.
    strict_1.default.equal((0, licenseKey_1.isCompleteLicenseKey)('KASSIR-A1B2-C3D4-E5F'), false);
    strict_1.default.equal((0, licenseKey_1.isCompleteLicenseKey)('KASSIR'), false);
    strict_1.default.equal((0, licenseKey_1.isCompleteLicenseKey)(''), false);
});
(0, node_test_1.test)('символы вне алфавита ключа до поля не доходят', () => {
    // U в Crockford Base32 нет, и заменить её нечем — отбрасывается, как любой
    // посторонний символ. Иначе окно сочло бы ключ набранным целиком и потратило
    // бы попытку на заведомо неверный.
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('A1B2C3D4E5FU'), 'KASSIR-A1B2-C3D4-E5F');
    strict_1.default.equal((0, licenseKey_1.isCompleteLicenseKey)('A1B2C3D4E5FU'), false);
});
(0, node_test_1.test)('спутанные с цифрами буквы читаются как цифры', () => {
    // I и L неотличимы от единицы, O — от нуля; в настоящем ключе их не бывает,
    // поэтому набранная буква может быть только неверно прочитанной цифрой.
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('IL0O1234ABCD'), 'KASSIR-1100-1234-ABCD');
});
(0, node_test_1.test)('префикс не портится подстановкой: в слове KASSIR есть «I»', () => {
    // Подстановка до снятия префикса превратила бы его в «KASS1R» — он перестал
    // бы узнаваться и уехал бы в тело ключа.
    strict_1.default.equal((0, licenseKey_1.formatLicenseKeyInput)('KASSIRA1B2C3D4E5F6'), FULL);
});
