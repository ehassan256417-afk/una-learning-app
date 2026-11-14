'use client';

/**
 * Images taken from the student's own slides, kept in this browser only
 * (IndexedDB, because images are too large for localStorage). A lesson shows
 * them next to the notes that cite the same slide. They are never sent to the
 * lesson service: lessons are written from the slide text alone.
 */

export interface FigureInput {
  /** 1-based slide (or page) number the image appears on. */
  page: number;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface StoredFigure {
  id: string;
  documentId: string;
  page: number;
  name: string;
  blob: Blob;
}

const DB_NAME = 'una-learning-figures';
const STORE = 'figures';
/** Keeps one document from filling the browser's storage. */
const MAX_BYTES_PER_DOCUMENT = 40 * 1024 * 1024;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('documentId', 'documentId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request ? request.result : undefined);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB transaction failed'));
        };
      }),
  );
}

/**
 * Replaces the stored images of one document. Returns how many were saved.
 * Failure is not an error for the caller: lessons work without pictures.
 */
export async function saveFigures(documentId: string, figures: FigureInput[]): Promise<number> {
  try {
    await deleteFigures(documentId);
    const counts = new Map<number, number>();
    let total = 0;
    const records: StoredFigure[] = [];
    for (const f of figures) {
      if (total + f.bytes.byteLength > MAX_BYTES_PER_DOCUMENT) break;
      total += f.bytes.byteLength;
      const n = counts.get(f.page) ?? 0;
      counts.set(f.page, n + 1);
      records.push({
        id: `${documentId}/${f.page}/${n}`,
        documentId,
        page: f.page,
        name: f.name,
        // Copy into a fresh buffer: the extractor may share one buffer between slides.
        blob: new Blob([f.bytes.slice()], { type: f.mime }),
      });
    }
    if (records.length === 0) return 0;
    await run('readwrite', (store) => {
      for (const r of records) store.put(r);
    });
    return records.length;
  } catch {
    return 0;
  }
}

/** Images on the given slides of one document, in slide order. Empty when none are stored. */
export async function loadFigures(documentId: string, pages: number[]): Promise<StoredFigure[]> {
  if (pages.length === 0) return [];
  try {
    const all = await run<StoredFigure[]>('readonly', (store) => store.index('documentId').getAll(documentId));
    const wanted = new Set(pages);
    return (all ?? []).filter((f) => wanted.has(f.page)).sort((a, b) => a.page - b.page || a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export async function deleteFigures(documentId: string): Promise<void> {
  try {
    const keys = await run<IDBValidKey[]>('readonly', (store) => store.index('documentId').getAllKeys(documentId));
    if (!keys || keys.length === 0) return;
    await run('readwrite', (store) => {
      for (const key of keys) store.delete(key);
    });
  } catch {
    // Nothing stored, or storage is unavailable: there is nothing to remove.
  }
}
