import * as Crypto from 'expo-crypto';
import { useMemo, useSyncExternalStore } from 'react';
import { Assistant } from '@/assistant/agent';
import { Ledger } from '@/core';
import { connection } from './connection';
import { openDatabase } from './database';

let opened: { ledger: Ledger; assistant: Assistant } | null = null;

/** Opens the ledger once at launch: upgrades the schema, then records any recurring entries due. */
export async function openLedger() {
  if (opened) return;
  const ledger = Ledger.open(await openDatabase(), { newId: () => Crypto.randomUUID(), now: () => new Date() });
  ledger.capture.runDue();
  opened = { ledger, assistant: new Assistant(ledger) };
}

function open() {
  if (!opened) throw new Error('The ledger is not open yet');
  return opened;
}

export const getLedger = () => open().ledger;
export const getAssistant = () => open().assistant;

/** Called when the app comes to the foreground: schedules and reference rates. */
export function refreshOnForeground() {
  const ledger = getLedger();
  ledger.capture.runDue();
  if (ledger.settings.get('fx_auto_refresh') !== '0' && ledger.rates.refreshDue()) {
    // Best effort: the request carries only currency codes.
    ledger.rates.refresh(fetch).catch(() => {});
  }
}

export function useLedger(): Ledger {
  return getLedger();
}

/** Reads from the ledger and re-reads whenever anything in it changes. */
export function useLive<T>(read: (ledger: Ledger) => T, deps: unknown[] = []): T {
  const ledger = getLedger();
  const revision = useSyncExternalStore(ledger.store.subscribe, ledger.store.getRevision, ledger.store.getRevision);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => read(ledger), [ledger, revision, ...deps]);
}

export function useConnection() {
  return useSyncExternalStore(connection.subscribe, connection.snapshot, connection.snapshot);
}

export function useChat() {
  const assistant = getAssistant();
  const items = useSyncExternalStore(assistant.subscribe, assistant.snapshot, assistant.snapshot);
  return { assistant, items, busy: assistant.busy };
}
