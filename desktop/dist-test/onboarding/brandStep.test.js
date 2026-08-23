"use strict";
/**
 * Устройство шага «Оформление».
 *
 * Шаг проверяется целиком, а не по одному полю, потому что ломается он именно
 * как целое: достаточно забыть `when` у одного поля, и настройка цвета снова
 * вылезет у магазина, который работает под заводским брендом, — а собрать это
 * глазами можно только пройдя мастер до четвёртого шага.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const fields_1 = require("./fields");
const types_1 = require("./types");
/** Номер шага «Оформление» в реестре. Человеку он показывается четвёртым. */
const BRAND_STEP = 3;
function draft(useFactoryBrand) {
    const data = (0, types_1.createOnboardingDraft)();
    data.branding.useFactoryBrand = useFactoryBrand;
    return data;
}
function layout(useFactoryBrand) {
    return (0, fields_1.sectionsForStep)(BRAND_STEP, draft(useFactoryBrand)).map(({ section, fields }) => ({
        section,
        ids: fields.map((field) => field.id),
    }));
}
(0, node_test_1.test)('под заводским брендом настраивать нечего', () => {
    const sections = layout(true);
    const names = sections.map((item) => item.section);
    // Выбор режима — и подпись на чеке, которая к бренду не относится.
    strict_1.default.deepEqual(names, ['Бренд системы', 'Чек']);
    strict_1.default.deepEqual(sections[0].ids, ['branding.factoryBrand']);
});
(0, node_test_1.test)('всё оформление собрано в одной секции своего бренда', () => {
    const sections = layout(false);
    const own = sections.find((item) => item.section === 'Свой бренд');
    strict_1.default.ok(own, 'секции «Свой бренд» нет');
    // Порядок важен: название первым — его чаще всего и путают с реквизитами.
    strict_1.default.deepEqual(own.ids, [
        'branding.brandName',
        'branding.logo',
        'branding.logoTextEditor',
        'branding.theme',
        'branding.primaryColor',
        'branding.receiptLook',
    ]);
});
(0, node_test_1.test)('отдельных секций «Тема интерфейса» и «Цвета» больше нет', () => {
    for (const factory of [true, false]) {
        const names = layout(factory).map((item) => item.section);
        strict_1.default.ok(!names.includes('Тема интерфейса'), `«Тема интерфейса» осталась (factory=${factory})`);
        strict_1.default.ok(!names.includes('Цвета'), `«Цвета» остались (factory=${factory})`);
        strict_1.default.ok(!names.includes('Логотип в интерфейсе'), `«Логотип в интерфейсе» остался отдельной секцией (factory=${factory})`);
    }
});
(0, node_test_1.test)('тема и цвет под заводским брендом не спрашиваются', () => {
    const ids = layout(true).flatMap((item) => item.ids);
    strict_1.default.ok(!ids.includes('branding.theme'));
    strict_1.default.ok(!ids.includes('branding.primaryColor'));
    strict_1.default.ok(!ids.includes('branding.brandName'));
});
(0, node_test_1.test)('подпись на чеке остаётся в обоих режимах', () => {
    // Это не бренд, а текст на ленте: телефон, Instagram, «Спасибо за покупку».
    // Спрятать его внутрь своего бренда значило бы отнять его у большинства.
    for (const factory of [true, false]) {
        const ids = layout(factory).flatMap((item) => item.ids);
        strict_1.default.ok(ids.includes('branding.receiptFooter'), `подписи нет (factory=${factory})`);
    }
});
(0, node_test_1.test)('признаки оборудования живут на первом шаге, и по одному разу', () => {
    // Сенсорный экран и камера — параметры устройства, а не оформления. Дубль
    // на другом шаге означал бы две галочки на одно значение.
    const data = (0, types_1.createOnboardingDraft)();
    for (const step of [0, 1, 2, 3, 4, 5]) {
        const ids = (0, fields_1.sectionsForStep)(step, data).flatMap((item) => item.fields.map((f) => f.id));
        const touch = ids.filter((id) => id === 'branding.touchScreen').length;
        const camera = ids.filter((id) => id === 'branding.hasCamera').length;
        strict_1.default.equal(touch, step === 0 ? 1 : 0, `сенсорный экран на шаге ${step}`);
        strict_1.default.equal(camera, step === 0 ? 1 : 0, `камера на шаге ${step}`);
    }
});
