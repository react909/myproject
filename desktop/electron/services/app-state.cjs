const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const STATE_FILE = () => path.join(app.getPath('userData'), 'app-state.json')

const DEFAULT_STATE = {
  installCompleted: false,
  firstLaunchAt: null,
  lastLaunchAt: null,
  launchCount: 0,
  lastVersion: null,
  // Overrides the backend's built-in local Postgres DSN — needed once a
  // shop has more than one till sharing a single Postgres over LAN. Left
  // null for the common single-till case: the backend already defaults to
  // postgresql+psycopg://postgres:postgres@127.0.0.1:5432/nurcrm on its own.
  postgresDsn: null,
}

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE())) return { ...DEFAULT_STATE }
    return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch }
  fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true })
  fs.writeFileSync(STATE_FILE(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/** Вызывается при каждом успешном старте упакованного приложения (не установщик). */
function markApplicationLaunch(version) {
  const prev = readState()
  const now = new Date().toISOString()
  return writeState({
    installCompleted: true,
    firstLaunchAt: prev.firstLaunchAt ?? now,
    lastLaunchAt: now,
    launchCount: (prev.launchCount || 0) + 1,
    lastVersion: version,
  })
}

function isFirstLaunch() {
  const s = readState()
  return !s.installCompleted || s.launchCount <= 1
}

module.exports = { readState, writeState, markApplicationLaunch, isFirstLaunch }
