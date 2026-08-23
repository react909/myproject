"use strict";
/**
 * Телефон магазина: один формат на всё приложение.
 *
 * Номер печатается в чеке и по нему покупатель ищет магазин, поэтому вольная
 * запись здесь не годится: «0555 12 34 56», «+996(555)123456» и «996555123456»
 * — один и тот же номер, и храниться он должен одинаково.
 *
 * Хранится каноничный вид `+996XXXXXXXXX`, показывается и печатается
 * `+996 XXX XXX XXX`. Разделение намеренное: пробелы — это оформление, и
 * держать их в данных значит сравнивать номера по оформлению.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHONE_NATIONAL_LENGTH = exports.PHONE_COUNTRY_CODE = void 0;
exports.phoneDigits = phoneDigits;
exports.phoneValue = phoneValue;
exports.formatPhoneInput = formatPhoneInput;
exports.formatPhone = formatPhone;
exports.phoneProblem = phoneProblem;
exports.caretAfterDigits = caretAfterDigits;
exports.digitsBefore = digitsBefore;
/** Код страны. Кыргызстан — касса продаётся здесь, выбор кода не предлагается. */
exports.PHONE_COUNTRY_CODE = '996';
/** Сколько цифр идёт после кода страны. Больше ввести нельзя. */
exports.PHONE_NATIONAL_LENGTH = 9;
/** «+996» в начале строки — неизменяемый префикс, а не часть номера. */
const PREFIX_PATTERN = new RegExp(`^\\+\\s*${exports.PHONE_COUNTRY_CODE}`);
/**
 * Национальный номер без кода страны — только цифры, не длиннее девяти.
 *
 * Разбор идёт в два шага, и оба нужны.
 *
 * Сначала снимается префикс «+996», если строка с него начинается. Поле ввода
 * всегда показывает его и отдаёт наружу вместе с набранным, поэтому без этого
 * шага код страны попадал в национальную часть: набранное «+996 555»
 * превращалось в «+996 996 555». Именно так поле и «дописывало цифры само».
 *
 * Потом — вставка из буфера, где префикса может не быть вовсе: «996555123456»
 * это тот же номер. Здесь код отбрасывается только если без него цифр всё
 * равно больше девяти: 996 — ещё и начало настоящих номеров (996 12 34 56), и
 * резать их безусловно значит не дать ввести такой номер вовсе.
 *
 * Ведущий ноль убирается всегда: междугородний «0555…» — это тот же «555…»,
 * и национальных номеров, начинающихся с нуля, нет.
 */
function phoneDigits(raw) {
    const text = (raw ?? '').trim();
    const body = PREFIX_PATTERN.test(text) ? text.replace(PREFIX_PATTERN, '') : text;
    let digits = body.replace(/\D/g, '');
    if (digits.length > exports.PHONE_NATIONAL_LENGTH && digits.startsWith(exports.PHONE_COUNTRY_CODE)) {
        digits = digits.slice(exports.PHONE_COUNTRY_CODE.length);
    }
    digits = digits.replace(/^0+/, '');
    return digits.slice(0, exports.PHONE_NATIONAL_LENGTH);
}
/** Каноничный вид для хранения: `+996XXXXXXXXX`. Пусто — значит не задан. */
function phoneValue(raw) {
    const digits = phoneDigits(raw);
    return digits ? `+${exports.PHONE_COUNTRY_CODE}${digits}` : '';
}
/** Для поля ввода: код страны стоит всегда, стереть его нельзя. */
function formatPhoneInput(raw) {
    const digits = phoneDigits(raw);
    const groups = digits.match(/.{1,3}/g) ?? [];
    // Пустой номер даёт «+996 » — с пробелом: курсор встаёт сразу за кодом, и
    // человек продолжает набор, ничего не стирая.
    return `+${exports.PHONE_COUNTRY_CODE} ${groups.join(' ')}`;
}
/** Для чека и сводки: пустой номер печатать нечем, поэтому пустая строка. */
function formatPhone(raw) {
    const digits = phoneDigits(raw);
    if (!digits)
        return '';
    return `+${exports.PHONE_COUNTRY_CODE} ${(digits.match(/.{1,3}/g) ?? []).join(' ')}`;
}
/**
 * Что не так с номером. Пустая строка — всё в порядке.
 *
 * Пустое поле здесь не ошибка: обязательность проверяет реестр полей, и два
 * сообщения об одном и том же («заполните поле» и «введите девять цифр») друг
 * друга только заслоняют.
 */
function phoneProblem(raw) {
    const digits = phoneDigits(raw);
    if (!digits)
        return '';
    if (digits.length < exports.PHONE_NATIONAL_LENGTH) {
        return `Введите ${exports.PHONE_NATIONAL_LENGTH} цифр после +${exports.PHONE_COUNTRY_CODE}.`;
    }
    return '';
}
/**
 * Куда поставить курсор, когда набрано `count` цифр.
 *
 * Нужна, чтобы правка середины номера не выбрасывала курсор в конец: маска
 * перерисовывает строку целиком, и без пересчёта позиции человек после каждой
 * цифры возвращает курсор руками.
 */
function caretAfterDigits(count) {
    const prefixLength = exports.PHONE_COUNTRY_CODE.length + 2; // «+996» и пробел
    if (count <= 0)
        return prefixLength;
    return prefixLength + count + Math.floor((count - 1) / 3);
}
/** Сколько цифр стоит в строке до позиции курсора. */
function digitsBefore(text, caret) {
    return (text.slice(0, caret).match(/\d/g) ?? []).length;
}
