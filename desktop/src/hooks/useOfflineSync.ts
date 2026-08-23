import { useEffect, useRef, useState } from 'react'

interface SyncItem {
  id: string
  type: 'sale' | 'product' | 'check'
  data: any
  timestamp: number
  synced: boolean
}

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncQueue, setSyncQueue] = useState<SyncItem[]>([])
  const isSyncingRef = useRef(false)

  // Загрузка очереди из IndexedDB
  useEffect(() => {
    loadQueueFromDB()
  }, [])

  // Отслеживание статуса сети
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      syncWithServer()
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  async function loadQueueFromDB() {
    try {
      const db = await openDB()
      const tx = db.transaction('syncQueue', 'readonly')
      const store = tx.objectStore('syncQueue')
      const items = await idbRequest<SyncItem[]>(store.getAll())
      setSyncQueue(items.filter((item) => !item.synced))
    } catch (error) {
      console.error('Failed to load sync queue:', error)
    }
  }

  async function addToQueue(type: SyncItem['type'], data: any) {
    const item: SyncItem = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      data,
      timestamp: Date.now(),
      synced: false,
    }

    try {
      const db = await openDB()
      const tx = db.transaction('syncQueue', 'readwrite')
      const store = tx.objectStore('syncQueue')
      await idbRequest(store.add(item))
      
      setSyncQueue(prev => [...prev, item])
      
      if (isOnline) {
        await syncWithServer()
      }
    } catch (error) {
      console.error('Failed to add to queue:', error)
    }
  }

  async function syncWithServer() {
    if (!isOnline || isSyncingRef.current || syncQueue.length === 0) return
    
    isSyncingRef.current = true
    
    try {
      const db = await openDB()
      const unsynced = syncQueue.filter(item => !item.synced)
      
      for (const item of unsynced) {
        // Отправка на сервер
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        })
        
        if (response.ok) {
          // Помечаем как синхронизированный
          const tx = db.transaction('syncQueue', 'readwrite')
          const store = tx.objectStore('syncQueue')
          await idbRequest(store.put({ ...item, synced: true }))
          
          setSyncQueue(prev => 
            prev.map(i => i.id === item.id ? { ...i, synced: true } : i)
          )
        }
      }
    } catch (error) {
      console.error('Sync failed:', error)
    } finally {
      isSyncingRef.current = false
    }
  }

  return { isOnline, syncQueue, addToQueue, syncWithServer }
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('NurCRMOfflineDB', 1)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id' })
      }
    }
  })
}