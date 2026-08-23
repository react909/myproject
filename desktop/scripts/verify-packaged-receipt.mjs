/**
 * Проверяет, что критичные файлы Electron попали в сборку (app.asar).
 * Запускается после electron-builder.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const asarPath = path.join(root, 'dist-electron', 'win-unpacked', 'resources', 'app.asar')

const requiredInAsar = [
  'electron/receipt/receipt-render.cjs',
  'electron/devices/device-manager.cjs',
  'electron/devices/bitmap-printer.cjs',
  'electron/devices/receipt-template.cjs',
  'dist/index.html',
]

function main() {
  if (!fs.existsSync(asarPath)) {
    console.error(`[verify-pack] Не найдена сборка: ${asarPath}`)
    console.error('Сначала выполните: npm run dist:dir')
    process.exit(1)
  }

  const files = new Set(asar.listPackage(asarPath).map((p) => p.replace(/\\/g, '/').replace(/^\//, '')))
  const missing = requiredInAsar.filter((rel) => !files.has(rel))

  if (missing.length > 0) {
    console.error('[verify-pack] В app.asar отсутствуют обязательные файлы:')
    for (const m of missing) console.error(`  - ${m}`)
    process.exit(1)
  }

  console.log('[verify-pack] OK: все критичные модули в app.asar')
}

main()
