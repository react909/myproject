import type { AppSettings } from '../../settings/appSettings'
import { buildReceiptBitmapHtml } from '../../receipt/receiptTemplate'
import type { ReceiptPrintPayload } from '../../receipt/receiptTemplate'

export async function applyDeviceSettings(settings: AppSettings) {
  return window.devicesAPI?.applySettings(settings)
}

export async function getDeviceStatus() {
  return window.devicesAPI?.getStatus()
}

export async function testPrinter(settings: AppSettings) {
  return window.devicesAPI?.testPrinter(settings)
}

export async function testScale(settings: AppSettings) {
  return window.devicesAPI?.testScale(settings)
}

export async function runDeviceDiagnostics(settings: AppSettings) {
  return window.devicesAPI?.runDiagnostics(settings)
}

export async function printReceipt(
  payload: ReceiptPrintPayload,
  settings: AppSettings,
) {
  if (!window.devicesAPI?.printReceipt) {
    return { ok: false, message: 'Печать доступна только в приложении NurCRM Manablock' }
  }
  const bitmapHtml = buildReceiptBitmapHtml(payload, settings.printer)
  return window.devicesAPI.printReceipt({ ...payload, bitmapHtml }, settings)
}

export async function listSerialPorts() {
  return window.devicesAPI?.listPorts() ?? []
}

export async function reconnectDevices(settings: AppSettings) {
  return window.devicesAPI?.reconnect?.(settings)
}
