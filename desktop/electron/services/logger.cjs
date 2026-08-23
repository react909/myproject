/**
 * Журнал ошибок приложения.
 *
 * Файлы разбиты по дням и каналам. К ним добавлены две вещи, без которых лог
 * бесполезен на реальной кассе:
 *
 * Ротация. Раньше файлы копились вечно: касса работает годами, и папка logs
 * росла молча, пока не кончалось место на диске моноблока. Теперь старые дни
 * удаляются, а слишком разросшийся файл дня обрезается — лог не должен
 * становиться причиной поломки, которую он призван объяснять.
 *
 * Архив. Разработчику нужны логи целиком, а не последние 80 строк с экрана.
 * Собрать их в один файл должен уметь тот, кто стоит у кассы, не открывая
 * проводник и не зная, где лежит профиль приложения.
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { app } = require('electron')

const LOG_DIR = () => path.join(app.getPath('userData'), 'logs')

/** Сколько дней храним. Две недели покрывают «позвонили через неделю». */
const KEEP_DAYS = 14

/** Потолок одного файла за день. Выше — обрезаем начало, храним хвост. */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Сколько оставляем при обрезке: свежие записи важнее первых. */
const TRIM_TO_BYTES = 1 * 1024 * 1024

function ensureDir() {
  const dir = LOG_DIR()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function dayStamp(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function logFileName(channel) {
  return `${channel}-${dayStamp()}.log`
}

/**
 * Удаляет файлы старше KEEP_DAYS. Вызывается редко — раз в запуск и при смене
 * суток, а не на каждую запись: перебирать каталог ради строки лога значит
 * превратить журнал в источник тормозов.
 */
function pruneOldFiles() {
  try {
    const dir = ensureDir()
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.log')) continue
      const full = path.join(dir, name)
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true })
      } catch {
        /* файл исчез сам — ничего делать не надо */
      }
    }
  } catch {
    /* ошибки диска не должны ронять приложение из-за журнала */
  }
}

/** Обрезает разросшийся файл, сохраняя хвост. */
function trimIfHuge(file) {
  try {
    const stat = fs.statSync(file)
    if (stat.size <= MAX_FILE_BYTES) return
    const handle = fs.openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(TRIM_TO_BYTES)
      const start = stat.size - TRIM_TO_BYTES
      fs.readSync(handle, buffer, 0, TRIM_TO_BYTES, start)
      // Первая строка почти наверняка обрезана посередине — выбрасываем её,
      // чтобы файл остался построчным JSON.
      const text = buffer.toString('utf8')
      const fromNewline = text.indexOf('\n')
      fs.writeFileSync(
        file,
        (fromNewline >= 0 ? text.slice(fromNewline + 1) : text),
        'utf8',
      )
    } finally {
      fs.closeSync(handle)
    }
  } catch {
    /* не удалось обрезать — журнал продолжит писаться как есть */
  }
}

let lastPruneDay = ''

function append(channel, level, message, meta) {
  try {
    const dir = ensureDir()
    const today = dayStamp()
    if (lastPruneDay !== today) {
      lastPruneDay = today
      pruneOldFiles()
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      meta: meta ?? null,
    })
    const file = path.join(dir, logFileName(channel))
    fs.appendFileSync(file, line + '\n', 'utf8')
    trimIfHuge(file)
  } catch {
    /* ignore disk errors */
  }
}

function readRecent(channel, limit = 80) {
  try {
    const file = path.join(ensureDir(), logFileName(channel))
    if (!fs.existsSync(file)) return []
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return { ts: '', level: 'info', message: l }
      }
    })
  } catch {
    return []
  }
}

/**
 * Собирает все логи в один сжатый файл для отправки разработчику.
 *
 * Формат — обычный текст с разделителями и gzip поверх: распаковывается любым
 * архиватором и читается блокнотом. Zip без внешних зависимостей в Electron
 * не собрать, а тянуть библиотеку ради кнопки диагностики незачем.
 */
function archiveLogs() {
  try {
    const dir = ensureDir()
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.log')).sort()
    if (files.length === 0) {
      return { ok: false, error: 'Логов пока нет.' }
    }

    const parts = [
      `Kassir ERP — журнал приложения`,
      `Собрано: ${new Date().toISOString()}`,
      `Версия: ${app.getVersion()}`,
      `Платформа: ${process.platform} ${process.arch}`,
      `Файлов: ${files.length}`,
      '',
    ]
    for (const name of files) {
      parts.push(`===== ${name} =====`)
      try {
        parts.push(fs.readFileSync(path.join(dir, name), 'utf8'))
      } catch (error) {
        parts.push(`(не удалось прочитать: ${error})`)
      }
      parts.push('')
    }

    const archivePath = path.join(dir, `kassir-logs-${dayStamp()}.log.gz`)
    fs.writeFileSync(archivePath, zlib.gzipSync(Buffer.from(parts.join('\n'), 'utf8')))
    return {
      ok: true,
      path: archivePath,
      sizeBytes: fs.statSync(archivePath).size,
      files: files.length,
    }
  } catch (error) {
    return { ok: false, error: `Не удалось собрать логи: ${error}` }
  }
}

module.exports = { append, readRecent, archiveLogs, pruneOldFiles, LOG_DIR }
