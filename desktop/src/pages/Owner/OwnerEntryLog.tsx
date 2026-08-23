/**
 * Журнал входов в кабинет: кто и когда открывал финансы.
 *
 * Не защита, а след. Дверь по-прежнему открывает только пароль владельца, но
 * теперь каждый вход оставляет снимок, и владелец видит лица. Для магазина, где
 * деньги смотрит один человек, а за кассой стоит смена, это работает не хуже
 * замка: подобрать пароль незаметно больше нельзя.
 *
 * Снимков может не быть вовсе — камеры на кассе нет или специалист снял галочку
 * в мастере. Пустое состояние здесь не ошибка, и объясняет оно именно это.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '../../api/client'
import { OwnerSkeleton } from './OwnerSkeleton'
import './OwnerEntryLog.css'

type EntryPhoto = {
  id: number
  actor_name: string
  image: string
  created_at: string | null
}

function formatMoment(iso: string | null): string {
  if (!iso) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  return at.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function OwnerEntryLog() {
  const [photos, setPhotos] = useState<EntryPhoto[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await apiGet('/api/auth/owner/entry-photo')
      setPhotos(Array.isArray(res?.data) ? res.data : [])
    } catch (caught) {
      setPhotos([])
      /*
        Причину называем прямо, а не «что-то пошло не так».
        Самая частая здесь — 404: журнал появился в свежей версии сервера, а
        запущен старый. Человеку в этом случае надо знать не «ошибка», а
        «перезапустите» — иначе он будет искать снимки, которых сервер ещё не
        умеет отдавать.
      */
      const status = (caught as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        setError(
          'Локальный сервер работает в старой версии и ещё не умеет отдавать журнал входов. ' +
            'Перезапустите приложение.',
        )
      } else if (status === 403) {
        setError('Режим владельца закрылся по бездействию. Откройте кабинет заново.')
      } else {
        setError('Не удалось прочитать журнал входов. Проверьте, что локальный сервер запущен.')
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Скелетон, а не пустой экран: снимки это десятки килобайт каждый, и на
  // кассе с историей первый кадр приходит не мгновенно.
  if (photos === null) return <OwnerSkeleton chart={false} rows={4} />

  return (
    <div className="oentry">
      <header className="oentry__head">
        <div>
          <h2 className="oentry__title">Кто заходил в кабинет</h2>
          <p className="oentry__caption">
            Снимок делается в момент входа — после того, как пароль уже принят. Это след, а не
            проверка: дверь открывает только пароль владельца.
          </p>
        </div>
        <button type="button" className="oentry__refresh" onClick={() => void load()}>
          Обновить
        </button>
      </header>

      {/*
        Ошибка ИЛИ пустое состояние, но не оба сразу.

        Раньше при сбое показывалось и «не удалось прочитать», и «снимков пока
        нет» — два разных объяснения одного экрана, причём второе неправдой:
        снимки могли быть, просто их не прочитали.
      */}
      {error ? (
        <p className="oentry__error" role="alert">
          {error}
        </p>
      ) : photos.length === 0 ? (
        <div className="oentry__empty">
          <p className="oentry__empty-title">Снимков пока нет</p>
          <p className="oentry__empty-note">
            Они появляются после входа в кабинет — если к кассе подключена камера и она отмечена в
            мастере настройки, на шаге «Оборудование».
          </p>
        </div>
      ) : (
        <ul className="oentry__grid">
          {photos.map((photo) => (
            <li key={photo.id} className="oentry__item">
              {/* Снимок принимается сервером только как JPEG (см. owner/entry-photo):
                  показывать в браузере то, что прислали «как есть», нельзя. */}
              <img className="oentry__photo" src={photo.image} alt="" />
              <div className="oentry__meta">
                <span className="oentry__when">{formatMoment(photo.created_at)}</span>
                <span className="oentry__who">{photo.actor_name || 'учётная запись неизвестна'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
