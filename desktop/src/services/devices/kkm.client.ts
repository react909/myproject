/**
 * Опрос фискального регистратора из интерфейса.
 *
 * Возвращает ровно то, что ответило устройство. Ничего не достраивает и не
 * подставляет значений по умолчанию: пустой ответ — это пустой ответ, и мастер
 * обязан оставить поля для ручного ввода.
 */

import { loadSettings } from '../../settings/appSettings'

/** Реквизиты, которые касса знает о себе сама. */
export type KkmRegistration = {
  serialNumber: string
  registrationNumber: string
  fiscalModule: string
  /** Версия ФФД из прошивки. Пусто — касса её не сообщила. */
  ffdVersion: string
  /** Версия ПО кассы из прошивки. */
  swVersion: string
}

export type KkmReadResult =
  | { ok: true; port: string; protocol: string; data: KkmRegistration }
  | { ok: false; reason: string; message: string; ports?: string[] }

const NOT_IN_APP: KkmReadResult = {
  ok: false,
  reason: 'no_bridge',
  message: 'Чтение с кассы доступно только в приложении Kassir ERP, не в браузере.',
}

export async function readKkmRegistration(): Promise<KkmReadResult> {
  const read = window.devicesAPI?.readKkmRegistration
  if (!read) return NOT_IN_APP
  try {
    // Настройки нужны, чтобы не дёргать порты, занятые весами и принтером.
    return await read(loadSettings())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось опросить кассу.'
    return { ok: false, reason: 'failed', message }
  }
}
