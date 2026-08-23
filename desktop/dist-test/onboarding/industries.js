"use strict";
/**
 * Сферы бизнеса и их пресеты.
 *
 * Сфера — не подпись на карточке. Она задаёт три вещи, которые дальше
 * использует весь каталог: набор атрибутов товара, единицу измерения по
 * умолчанию и шаблон карточки товара. Всё это описано здесь и только здесь,
 * чтобы «одежда» означала одно и то же в мастере, в справочнике и в форме
 * добавления товара.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDUSTRY_IDS = exports.INDUSTRIES = void 0;
exports.industryById = industryById;
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const SHOE_SIZES = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];
const GENDERS = ['Мужской', 'Женский', 'Унисекс', 'Детский'];
const SEASONS = ['Зима', 'Лето', 'Демисезон', 'Всесезон'];
const SHOE_MATERIALS = ['Кожа', 'Замша', 'Нубук', 'Текстиль', 'Экокожа', 'Резина'];
exports.INDUSTRIES = [
    {
        id: 'clothing',
        title: 'Одежда',
        enables: 'Размер, цвет, пол, сезон и бренд; карточка с размерной сеткой; единица «шт».',
        defaultUnit: 'шт',
        units: ['шт', 'компл'],
        defaultKind: 'piece',
        cardTemplate: 'variants',
        attributes: [
            { key: 'size', label: 'Размер', kind: 'select', options: SIZES, inList: true, required: true },
            { key: 'color', label: 'Цвет', kind: 'text', inList: true },
            { key: 'gender', label: 'Пол', kind: 'select', options: GENDERS },
            { key: 'season', label: 'Сезон', kind: 'select', options: SEASONS },
            { key: 'brand', label: 'Бренд', kind: 'text', inList: true },
        ],
        categories: ['Мужская одежда', 'Женская одежда', 'Детская одежда', 'Аксессуары'],
    },
    {
        id: 'shoes',
        title: 'Обувь',
        enables: 'Размер (35–45), цвет и материал; карточка с размерной сеткой; единица «пара».',
        defaultUnit: 'пара',
        units: ['пара', 'шт'],
        defaultKind: 'piece',
        cardTemplate: 'variants',
        attributes: [
            { key: 'size', label: 'Размер', kind: 'select', options: SHOE_SIZES, inList: true, required: true },
            { key: 'color', label: 'Цвет', kind: 'text', inList: true },
            { key: 'material', label: 'Материал', kind: 'select', options: SHOE_MATERIALS, inList: true },
            { key: 'gender', label: 'Пол', kind: 'select', options: GENDERS },
            { key: 'season', label: 'Сезон', kind: 'select', options: SEASONS },
        ],
        categories: ['Мужская обувь', 'Женская обувь', 'Детская обувь', 'Уход за обувью'],
    },
    {
        id: 'cosmetics',
        title: 'Косметика и парфюмерия',
        enables: 'Объём, срок годности, бренд и тон; карточка партии со сроком; единицы «шт» и «мл».',
        defaultUnit: 'шт',
        units: ['шт', 'мл'],
        defaultKind: 'piece',
        cardTemplate: 'batch',
        attributes: [
            { key: 'volume', label: 'Объём, мл', kind: 'number', inList: true },
            { key: 'expiry', label: 'Срок годности', kind: 'date', required: true },
            { key: 'brand', label: 'Бренд', kind: 'text', inList: true },
            { key: 'shade', label: 'Тон', kind: 'text', inList: true },
        ],
        categories: ['Уход за лицом', 'Уход за телом', 'Парфюмерия', 'Декоративная косметика'],
    },
    {
        id: 'grocery',
        title: 'Продукты',
        enables: 'Вес, штрихкод и срок годности; весовая карточка с этикеткой; единицы «кг», «шт», «л».',
        defaultUnit: 'кг',
        units: ['кг', 'шт', 'л'],
        defaultKind: 'weight',
        cardTemplate: 'weighted',
        attributes: [
            { key: 'weight', label: 'Вес фасовки, кг', kind: 'number', inList: true },
            { key: 'barcode', label: 'Штрихкод', kind: 'barcode', inList: true, required: true },
            { key: 'expiry', label: 'Срок годности', kind: 'date', required: true },
        ],
        categories: ['Молочное', 'Хлеб и выпечка', 'Бакалея', 'Овощи и фрукты', 'Напитки'],
    },
    {
        id: 'electronics',
        title: 'Электроника',
        enables: 'Серийный номер, гарантия и модель; карточка с учётом по серийникам; единица «шт».',
        defaultUnit: 'шт',
        units: ['шт', 'компл'],
        defaultKind: 'piece',
        cardTemplate: 'serial',
        attributes: [
            { key: 'serial', label: 'Серийный номер', kind: 'text', inList: true, required: true },
            { key: 'warranty', label: 'Гарантия, мес.', kind: 'number' },
            { key: 'model', label: 'Модель', kind: 'text', inList: true },
            { key: 'brand', label: 'Бренд', kind: 'text' },
        ],
        categories: ['Смартфоны', 'Аксессуары', 'Бытовая техника', 'Компьютеры'],
    },
    {
        id: 'pharmacy',
        title: 'Аптека',
        enables: 'Серия, срок годности и рецептурность; карточка партии; единица «уп».',
        defaultUnit: 'уп',
        units: ['уп', 'шт', 'мл'],
        defaultKind: 'piece',
        cardTemplate: 'batch',
        attributes: [
            { key: 'batch', label: 'Серия', kind: 'text', inList: true, required: true },
            { key: 'expiry', label: 'Срок годности', kind: 'date', inList: true, required: true },
            { key: 'prescription', label: 'Рецептурный', kind: 'select', options: ['Да', 'Нет'] },
            { key: 'manufacturer', label: 'Производитель', kind: 'text' },
        ],
        categories: ['Лекарства', 'БАДы', 'Гигиена', 'Медтехника'],
    },
    {
        id: 'cafe',
        title: 'Кафе',
        enables: 'Состав, порция и время приготовления; карточка блюда; единица «порция». Склад по умолчанию не ведётся.',
        defaultUnit: 'порция',
        units: ['порция', 'шт', 'л'],
        defaultKind: 'piece',
        cardTemplate: 'recipe',
        // Кафе продаёт блюда, а не позиции склада: остатки там ведут по продуктам
        // в составе, а такого учёта касса пока не делает.
        attributes: [
            { key: 'recipe', label: 'Состав', kind: 'text' },
            { key: 'portion', label: 'Порция, г', kind: 'number', inList: true },
            { key: 'cookTime', label: 'Время приготовления, мин', kind: 'number' },
        ],
        categories: ['Горячее', 'Салаты', 'Напитки', 'Десерты'],
    },
    {
        id: 'services',
        title: 'Услуги',
        enables: 'Длительность и исполнитель; карточка услуги; единица «услуга». Склад не ведётся.',
        defaultUnit: 'услуга',
        units: ['услуга', 'час'],
        defaultKind: 'service',
        cardTemplate: 'service',
        attributes: [
            { key: 'duration', label: 'Длительность, мин', kind: 'number', inList: true },
            { key: 'master', label: 'Исполнитель', kind: 'text', inList: true },
        ],
        categories: ['Основные услуги', 'Дополнительные услуги'],
    },
    {
        id: 'other',
        title: 'Другое',
        enables: 'Без специальных атрибутов: название, цена, штрихкод; обычная карточка; единица «шт».',
        defaultUnit: 'шт',
        units: ['шт', 'кг', 'л', 'м'],
        defaultKind: 'piece',
        cardTemplate: 'simple',
        attributes: [{ key: 'barcode', label: 'Штрихкод', kind: 'barcode', inList: true }],
        categories: ['Товары', 'Разное'],
    },
];
const BY_ID = new Map(exports.INDUSTRIES.map((item) => [item.id, item]));
function industryById(id) {
    return BY_ID.get(id) ?? exports.INDUSTRIES[exports.INDUSTRIES.length - 1];
}
exports.INDUSTRY_IDS = exports.INDUSTRIES.map((item) => item.id);
