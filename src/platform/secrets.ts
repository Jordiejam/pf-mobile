import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { SecretStore } from '@/assistant/chatgptAuth';

/**
 * Credentials live in the Keychain (iOS) or Keystore-backed storage (Android), readable
 * only on this device. The browser build is a development preview with no secure
 * storage, so there they last only until the tab closes.
 */
const memory = new Map<string, string>();

export const secrets: SecretStore =
  Platform.OS === 'web'
    ? {
        get: async (key) => memory.get(key) ?? null,
        set: async (key, value) => void memory.set(key, value),
        remove: async (key) => void memory.delete(key),
      }
    : {
        get: (key) => SecureStore.getItemAsync(key),
        set: (key, value) =>
          SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
        remove: (key) => SecureStore.deleteItemAsync(key),
      };
