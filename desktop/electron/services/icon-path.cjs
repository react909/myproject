const fs = require('node:fs')
const path = require('node:path')
const { app, nativeImage } = require('electron')

/**
 * Путь к icon.ico вне asar (extraResources) или в electron/.
 */
function resolveIconFilePath() {
  const candidates = []
  try {
    if (app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'icon.ico'))
    }
  } catch {
    /* app not ready */
  }
  candidates.push(
    path.join(__dirname, '..', 'icon.ico'),
    path.join(__dirname, '../../build-resources/icon.ico'),
  )
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function resolveAppIconImage() {
  const file = resolveIconFilePath()
  if (!file) return undefined
  const img = nativeImage.createFromPath(file)
  return img.isEmpty() ? undefined : img
}

module.exports = { resolveIconFilePath, resolveAppIconImage }
