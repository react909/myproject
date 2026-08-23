"use strict";
/**
 * Единый интерфейс приёма оплаты.
 *
 * Экран оплаты знает только этот интерфейс и ничего не знает ни про банки, ни
 * про терминалы. Добавить новый банк — значит добавить пресет и, если у него
 * свой формат, одну реализацию; правок в UI при этом ноль. Ради этого всё и
 * затевалось: иначе каждый банк тянул бы за собой ветку в модалке оплаты.
 *
 * Три уровня интеграции описаны видом провайдера:
 *
 * - `qr-static` — картинка QR банка. Работает сразу, без договоров, но сумму
 *   вводит клиент, а подтверждает оплату кассир глазами. Такие оплаты
 *   помечаются `confirmation: 'manual'` — см. журнал ручных подтверждений.
 * - `qr-dynamic` — касса запрашивает у банка QR с уже вшитой суммой и сама
 *   узнаёт о факте оплаты. Клиент не может заплатить меньше, кассир ничего не
 *   подтверждает руками.
 * - `terminal` — команда банковскому POS-терминалу, результат возвращает он.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CASH_PROVIDER_ID = exports.PAYMENT_POLL_INTERVAL_MS = exports.PAYMENT_TIMEOUT_SECONDS = void 0;
exports.defaultProviderConfigs = defaultProviderConfigs;
exports.providerConfigLabel = providerConfigLabel;
exports.providerReadiness = providerReadiness;
/** Сколько ждём оплату по умолчанию, прежде чем предложить отмену. */
exports.PAYMENT_TIMEOUT_SECONDS = 180;
/** Как часто опрашиваем статус динамического платежа. */
exports.PAYMENT_POLL_INTERVAL_MS = 2000;
/** Наличные есть всегда и настройки не требуют — в конфиге их нет. */
exports.CASH_PROVIDER_ID = 'cash';
/** Провайдеры, включённые в новой установке: работают без единого договора. */
function defaultProviderConfigs() {
    return [
        {
            id: 'qr-static-1',
            kind: 'qr-static',
            title: 'QR банка',
            enabled: true,
        },
    ];
}
function providerConfigLabel(config) {
    return config.title.trim() || 'Без названия';
}
/** Готов ли провайдер к работе или его ещё донастраивают. */
function providerReadiness(config) {
    if (config.kind === 'qr-static') {
        return config.imageDataUrl
            ? { ready: true, reason: '' }
            : { ready: false, reason: 'Не загружена картинка QR' };
    }
    if (config.kind === 'qr-dynamic') {
        if (!config.baseUrl?.trim())
            return { ready: false, reason: 'Не указан адрес API банка' };
        if (!config.merchantId?.trim())
            return { ready: false, reason: 'Не указан идентификатор мерчанта' };
        if (!config.secretSet)
            return { ready: false, reason: 'Не задан мерчант-ключ' };
        return { ready: true, reason: '' };
    }
    if (config.kind === 'terminal') {
        if (config.transport === 'tcp') {
            return config.host?.trim()
                ? { ready: true, reason: '' }
                : { ready: false, reason: 'Не указан адрес терминала' };
        }
        return config.comPort?.trim()
            ? { ready: true, reason: '' }
            : { ready: false, reason: 'Не указан COM-порт терминала' };
    }
    return { ready: true, reason: '' };
}
