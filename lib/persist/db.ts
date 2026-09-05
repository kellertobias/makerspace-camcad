import { openDB, type IDBPDatabase } from 'idb';

/** One IndexedDB database for everything cached in the browser: user fonts and the working session. */
const DB_NAME = 'cnc-cam';
const DB_VERSION = 2;
let dbp: Promise<IDBPDatabase> | null = null;

export const db = (): Promise<IDBPDatabase> => (dbp ??= openDB(DB_NAME, DB_VERSION, {
  upgrade(d) {
    if (!d.objectStoreNames.contains('fonts')) d.createObjectStore('fonts', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
  },
}));
