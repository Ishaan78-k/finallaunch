import { SAVE_SLOTS, type SaveSlotId } from '../data/constants';
import { validateSave, type SaveData } from './saveSchema';

const DB_NAME = 'rajneeti3d';
const STORE = 'saves';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open save database'));
  });
}

function request<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Save database error'));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function writeSave(slot: SaveSlotId, data: SaveData): Promise<void> {
  await request('readwrite', (s) => s.put(data, slot));
}

/** Returns null for empty or corrupt slots. */
export async function readSave(slot: SaveSlotId): Promise<SaveData | null> {
  const raw = await request<unknown>('readonly', (s) => s.get(slot));
  return validateSave(raw);
}

export async function listSaves(): Promise<Record<SaveSlotId, SaveData | null>> {
  const out = { slot1: null, slot2: null, slot3: null } as Record<SaveSlotId, SaveData | null>;
  for (const slot of SAVE_SLOTS) {
    try {
      out[slot] = await readSave(slot);
    } catch {
      out[slot] = null;
    }
  }
  return out;
}

export async function latestSave(): Promise<SaveData | null> {
  const all = await listSaves();
  return Object.values(all)
    .filter((s): s is SaveData => s !== null)
    .sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}
