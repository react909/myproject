const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

function getCurrentVersion() {
  return app.getVersion()
}

function loadChangelog() {
  const file = path.join(__dirname, 'changelog.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function getChangelogFor(version) {
  const all = loadChangelog()
  return all[version] ?? {
    version,
    releaseDate: null,
    sizeMb: null,
    features: ['Обновление системы NurCRM Manablock'],
    fixes: [],
  }
}

module.exports = { getCurrentVersion, loadChangelog, getChangelogFor }
