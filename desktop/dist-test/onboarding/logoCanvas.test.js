"use strict";
/**
 * Обработка картинок: автообрезка полей и круглая маска.
 *
 * Проверяется расчётная часть — та, что решает, где кончается фон и какой
 * квадрат вырезать под круг. Рисование на canvas в этих тестах не участвует:
 * оно живёт в браузере, а сама арифметика от него не зависит.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const logoCanvas_1 = require("./logoCanvas");
/** Картинка нужного размера, залитая одним цветом. */
function fill(width, height, color) {
    const data = [];
    for (let i = 0; i < width * height; i += 1)
        data.push(...color);
    return data;
}
/** Ставит точку заданного цвета. */
function put(data, width, x, y, color) {
    const p = (y * width + x) * 4;
    data[p] = color[0];
    data[p + 1] = color[1];
    data[p + 2] = color[2];
    data[p + 3] = color[3];
}
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const CLEAR = [0, 0, 0, 0];
(0, node_test_1.test)('белые поля вокруг знака находятся', () => {
    const data = fill(20, 20, WHITE);
    for (let y = 5; y <= 14; y += 1) {
        for (let x = 4; x <= 12; x += 1)
            put(data, 20, x, y, BLACK);
    }
    strict_1.default.deepEqual((0, logoCanvas_1.contentBounds)(data, 20, 20), { left: 4, top: 5, right: 12, bottom: 14 });
});
(0, node_test_1.test)('прозрачные поля находятся по альфа-каналу', () => {
    const data = fill(10, 10, CLEAR);
    put(data, 10, 3, 7, BLACK);
    put(data, 10, 6, 8, BLACK);
    strict_1.default.deepEqual((0, logoCanvas_1.contentBounds)(data, 10, 10), { left: 3, top: 7, right: 6, bottom: 8 });
});
(0, node_test_1.test)('фон не обязан быть идеально ровным', () => {
    // Снимок в JPEG даёт «почти белый» фон: 250 против 255. С допуском это фон,
    // без допуска обрезка не срабатывала бы вовсе.
    const data = fill(12, 12, [250, 251, 250, 255]);
    put(data, 12, 6, 6, BLACK);
    strict_1.default.deepEqual((0, logoCanvas_1.contentBounds)(data, 12, 12), { left: 6, top: 6, right: 6, bottom: 6 });
});
(0, node_test_1.test)('однотонная картинка — обрезать нечего', () => {
    strict_1.default.equal((0, logoCanvas_1.contentBounds)(fill(8, 8, WHITE), 8, 8), null);
    strict_1.default.equal((0, logoCanvas_1.contentBounds)(fill(8, 8, CLEAR), 8, 8), null);
});
(0, node_test_1.test)('круг вписывается в квадрат по центру картинки', () => {
    // Широкий знак 4:1: круг режется по центру, иначе вышел бы овал.
    strict_1.default.deepEqual((0, logoCanvas_1.circleMaskGeometry)(400, 100), {
        side: 100,
        offsetX: 150,
        offsetY: 0,
        radius: 50,
    });
    strict_1.default.deepEqual((0, logoCanvas_1.circleMaskGeometry)(120, 300), {
        side: 120,
        offsetX: 0,
        offsetY: 90,
        radius: 60,
    });
    strict_1.default.deepEqual((0, logoCanvas_1.circleMaskGeometry)(256, 256), {
        side: 256,
        offsetX: 0,
        offsetY: 0,
        radius: 128,
    });
});
