/**
 * Production ICO для exe, NSIS installer, ярлыков и taskbar.
 *
 * Источник ровно один — src/assets/kassir-logo.png, тот же файл, что стоит в
 * шапке приложения и на экранах входа (см. brand/brand.ts). Иконка окна и
 * интерфейс обязаны показывать один и тот же знак: разошедшись, они выглядят
 * как две разные программы в одной панели задач.
 *
 * Раньше здесь была лестница из четырёх кандидатов — images.png, assets/
 * logo.png, src/assets/logo-square.png и хешированный файл из dist. Она и
 * поддерживала разнобой: скрипт брал первый попавшийся, а какой именно — от
 * состояния каталога. Кандидатов больше нет: файл либо тот, либо сборка
 * останавливается.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** Единственный источник знака. png-to-ico требует квадратный PNG. */
const src = path.join(root, 'src', 'assets', 'kassir-logo.png')

if (!fs.existsSync(src)) {
  console.error(`Logo PNG not found: ${path.relative(root, src)}`)
  process.exit(1)
}

const outDirs = [
  path.join(root, 'build-resources'),
  path.join(root, 'electron'),
]
for (const dir of outDirs) {
  fs.mkdirSync(dir, { recursive: true })
}

/*
  Копии в build-resources/logo.png больше нет.

  Она была пятым файлом того же изображения и жила ровно затем, чтобы
  png-to-ico было что читать, — но читает он и исходник напрямую. Копия при
  этом попадала в репозиторий и старела отдельно от оригинала.
*/
/** png-to-ico создаёт multi-size ICO из одного PNG */
const buf = await pngToIco(src)
if (buf.length > 400_000) {
  console.warn(`WARN: icon.ico is large (${buf.length} bytes) — check logo resolution`)
}

for (const dir of outDirs) {
  const outIco = path.join(dir, 'icon.ico')
  fs.writeFileSync(outIco, buf)
  console.log('OK:', outIco, `(${buf.length} bytes) from ${path.relative(root, src)}`)
}
