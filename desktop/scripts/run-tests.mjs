/**
 * Прогон юнит-тестов: собрать TypeScript и отдать встроенному `node --test`.
 *
 * Отдельным скриптом, потому что между сборкой и запуском нужен ещё один шаг:
 * в каталог сборки кладётся package.json с "type": "commonjs". Без него Node
 * читает тип из package.json приложения (там "module") и отказывается
 * выполнять собранные файлы.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'dist-test')

/* Одной строкой, а не командой с массивом аргументов: на Windows tsc — это
   .cmd, его запускает оболочка, а передача массива вместе с shell даёт
   предупреждение об экранировании. */
const run = (command) => {
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('tsc -p tsconfig.test.json')

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'package.json'), '{ "type": "commonjs" }\n')

// Шаблоном, а не каталогом: свежие версии Node понимают позиционный аргумент
// как glob, и каталог целиком они пробуют выполнить как обычный файл.
run('node --test "dist-test/**/*.test.js"')
