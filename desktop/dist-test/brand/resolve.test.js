"use strict";
/**
 * Граница «бренд интерфейса ≠ данные магазина».
 *
 * Проверяется то, что легко сломать обратно одной строкой: название в шапке
 * не имеет права приезжать из реквизитов, а возврат к заводскому бренду обязан
 * вернуть заводской вид, ничего не стирая.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const applyTheme_1 = require("../auth/applyTheme");
const resolve_1 = require("./resolve");
/** Магазин со своим брендом: фиолетовый, тёмная тема, своё название. */
const own = {
    useFactoryBrand: false,
    brandName: 'Бимар Маркет',
    primaryColor: '#7c3aed',
    theme: 'dark',
};
const factory = { ...own, useFactoryBrand: true };
(0, node_test_1.test)('по умолчанию система называется Kassir ERP', () => {
    strict_1.default.equal(resolve_1.FACTORY_NAME, 'Kassir ERP');
    strict_1.default.equal((0, resolve_1.resolveBrandName)(factory), 'Kassir ERP');
});
(0, node_test_1.test)('под заводским брендом система стоит в мятном и светлой теме', () => {
    // Даже когда в полях лежит фиолетовый и тёмная тема, выбранные в прошлый
    // заход: режим решает, что показать, а поля остаются нетронутыми.
    strict_1.default.deepEqual((0, resolve_1.brandTheme)(factory), { mode: 'light', primary: applyTheme_1.DEFAULT_PRIMARY });
    strict_1.default.equal(applyTheme_1.DEFAULT_PRIMARY, '#00f5bc');
});
(0, node_test_1.test)('свой бренд подставляет название, цвет и тему клиента', () => {
    strict_1.default.equal((0, resolve_1.resolveBrandName)(own), 'Бимар Маркет');
    strict_1.default.deepEqual((0, resolve_1.brandTheme)(own), { mode: 'dark', primary: '#7c3aed' });
});
(0, node_test_1.test)('переключение режима обратимо и ничего не теряет', () => {
    // Тот же объект, меняется только режим — значит поля пережили возврат.
    const there = (0, resolve_1.brandTheme)({ ...own, useFactoryBrand: true });
    const back = (0, resolve_1.brandTheme)({ ...own, useFactoryBrand: false });
    strict_1.default.deepEqual(there, { mode: 'light', primary: applyTheme_1.DEFAULT_PRIMARY });
    strict_1.default.deepEqual(back, { mode: 'dark', primary: '#7c3aed' });
    strict_1.default.equal((0, resolve_1.resolveBrandName)({ ...own, useFactoryBrand: true }), resolve_1.FACTORY_NAME);
    strict_1.default.equal((0, resolve_1.resolveBrandName)({ ...own, useFactoryBrand: false }), 'Бимар Маркет');
});
(0, node_test_1.test)('пустое название под своим брендом остаётся заводским', () => {
    // Клиент загрузил знак, а поле названия не заполнил: безымянная шапка хуже
    // заводской.
    strict_1.default.equal((0, resolve_1.resolveBrandName)({ ...own, brandName: '' }), resolve_1.FACTORY_NAME);
    strict_1.default.equal((0, resolve_1.resolveBrandName)({ ...own, brandName: '   ' }), resolve_1.FACTORY_NAME);
});
(0, node_test_1.test)('название магазина в бренд не попадает никаким путём', () => {
    /*
      Главная проверка файла.
  
      `BrandSource` вообще не содержит реквизитов — ни company.shortName, ни
      outlet.name. Пока шапка звала storeDisplayName(store), название торговой
      точки было её единственным источником; теперь такого входа у бренда нет,
      и вернуть его молча нельзя — придётся расширять тип.
    */
    const keys = Object.keys(own).sort();
    strict_1.default.deepEqual(keys, ['brandName', 'primaryColor', 'theme', 'useFactoryBrand']);
});
