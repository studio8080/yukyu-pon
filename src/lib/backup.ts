// 自動バックアップ: 利用者が選んだファイル（パソコンの中）に、変更のたびに上書き保存する。
// File System Access API（Chrome・Edge）だけで動く。ほかのブラウザでは手動のバックアップを促す。
// ファイルの置き場所は利用者のパソコンの中で、外部へは送らない。

import { create } from 'zustand'
import { currentData, dailySnapshot, makeBackup, parseBackup, useStore, type Data } from '../store'

type Handle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>
}

type SaveFilePicker = (o: {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<Handle>

export type AutoState = 'unsupported' | 'off' | 'ok' | 'need-permission' | 'error'

export const useAutosave = create<{ state: AutoState; fileName: string; savedAt: string | null; error: string }>(() => ({
  state: 'off',
  fileName: '',
  savedAt: null,
  error: '',
}))

export function autosaveSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'indexedDB' in window
}

// --- ファイルの「場所」(handle) を IndexedDB に覚えておく（中身ではない）
const DB = 'yukyu-pon'
const STORE = 'handles'

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => open.result.close()
    }
  })
}

let handle: Handle | null = null

async function write(data: Data) {
  if (!handle) return
  try {
    const perm = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted'
    if (perm !== 'granted') {
      useAutosave.setState({ state: 'need-permission' })
      return
    }
    const w = await handle.createWritable()
    await w.write(makeBackup(data))
    await w.close()
    useAutosave.setState({ state: 'ok', savedAt: new Date().toISOString(), error: '' })
    useStore.getState().markBackedUp()
  } catch (e) {
    useAutosave.setState({ state: 'error', error: (e as Error).message })
  }
}

/** 保存先を選んで、すぐに1回保存する（ボタンから呼ぶ） */
export async function chooseAutosaveFile(): Promise<boolean> {
  if (!autosaveSupported()) return false
  try {
    const picker = (window as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker
    handle = await picker({
      suggestedName: '有休ポン_自動バックアップ.json',
      types: [{ description: '有休ポンのバックアップ', accept: { 'application/json': ['.json'] } }],
    })
    await idb('readwrite', (s) => s.put(handle, 'autosave'))
    useAutosave.setState({ fileName: handle.name })
    await write(currentData())
    return true
  } catch {
    return false // キャンセル
  }
}

/** ブラウザを開き直したあと、書き込みの許可をもらい直す（ボタンから呼ぶ） */
export async function resumeAutosave() {
  if (!handle?.requestPermission) return
  const p = await handle.requestPermission({ mode: 'readwrite' })
  if (p === 'granted') await write(currentData())
}

export async function stopAutosave() {
  handle = null
  try {
    await idb('readwrite', (s) => s.delete('autosave'))
  } catch {
    /* ignore */
  }
  useAutosave.setState({ state: 'off', fileName: '', savedAt: null })
}

/** 自動バックアップのファイルから読み戻す */
export async function readAutosaveFile(): Promise<Data | null> {
  if (!handle) return null
  const f = await handle.getFile()
  return parseBackup(await f.text())
}

/** 起動時に呼ぶ。覚えている保存先を読み、データが変わるたびに保存する */
export async function initAutosave() {
  // 保存領域を「消されにくい」扱いにしてもらう（ブラウザが容量不足のときに勝手に消さない）
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    /* ignore */
  }

  if (!autosaveSupported()) {
    useAutosave.setState({ state: 'unsupported' })
  } else {
    try {
      handle = (await idb<Handle | undefined>('readonly', (s) => s.get('autosave'))) ?? null
    } catch {
      handle = null
    }
    if (handle) {
      useAutosave.setState({ fileName: handle.name })
      const perm = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted'
      useAutosave.setState({ state: perm === 'granted' ? 'ok' : 'need-permission' })
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  useStore.subscribe((s, prev) => {
    if (s.employees === prev.employees && s.leaves === prev.leaves && s.settings === prev.settings) return
    dailySnapshot()
    if (!handle) return
    clearTimeout(timer)
    timer = setTimeout(() => write(currentData()), 1500)
  })
}
