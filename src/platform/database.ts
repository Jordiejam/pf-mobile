import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import type { Db } from '@/core';

/**
 * The ledger's SQLite file on this device.
 *
 * The browser build is a development preview only. There SQLite runs in a worker that
 * must finish loading before it can answer synchronously, so it is opened asynchronously
 * first, and it is kept in memory because the browser's file storage is too slow for
 * synchronous use: a browser preview starts empty every time.
 */
export async function openDatabase(): Promise<Db> {
  const sqlite = Platform.OS === 'web' ? await SQLite.openDatabaseAsync(':memory:') : SQLite.openDatabaseSync('ledger.db');
  return {
    exec: (sql) => sqlite.execSync(sql),
    run: (sql, params = []) => void sqlite.runSync(sql, params),
    all: <T>(sql: string, params: (string | number | null)[] = []) => sqlite.getAllSync<T>(sql, params),
  };
}
