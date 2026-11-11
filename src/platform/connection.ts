import * as Crypto from 'expo-crypto';
import { fetch as streamingFetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { ChatGptAuth } from '@/assistant/chatgptAuth';
import { ResponsesClient, type Credentials, type ModelInfo } from '@/assistant/responses';
import { loopbackBrowser } from './loopback';
import { secrets } from './secrets';

const base64Url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// React Native's own fetch cannot read a response as it streams; Expo's can.
const fetcher = (Platform.OS === 'web' ? fetch.bind(globalThis) : streamingFetch) as typeof fetch;

export const chatGptAuth = new ChatGptAuth({
  secrets,
  browser: loopbackBrowser,
  fetch: fetcher,
  randomToken: async () => base64Url(btoa(String.fromCharCode(...Crypto.getRandomBytes(32)))),
  sha256: async (text) =>
    base64Url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: Crypto.CryptoEncoding.BASE64 })),
  newId: () => Crypto.randomUUID(),
});

export type ConnectionState =
  | { mode: 'none' }
  | { mode: 'chatgpt'; email: string; model: string | null }
  | { mode: 'api_key'; model: string | null };

const KEYS = { apiKey: 'openai_api_key', model: 'assistant_model' };

/**
 * How the assistant reaches a model: the person's ChatGPT plan (Sign in with ChatGPT) or
 * their own OpenAI API key. Both use the same API; only the credential differs.
 */
class AssistantConnection {
  state: ConnectionState = { mode: 'none' };
  ready = false;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;

  private set(state: ConnectionState) {
    this.state = state;
    this.ready = true;
    this.listeners.forEach((listener) => listener());
  }

  async load() {
    const model = await secrets.get(KEYS.model);
    const account = await chatGptAuth.account();
    if (account) return this.set({ mode: 'chatgpt', email: account.email, model });
    this.set((await secrets.get(KEYS.apiKey)) ? { mode: 'api_key', model } : { mode: 'none' });
  }

  private credentials(): Credentials {
    if (this.state.mode === 'chatgpt') {
      return { planUsage: true, token: (options) => chatGptAuth.accessToken(options) };
    }
    return {
      planUsage: false,
      token: async () => {
        const key = await secrets.get(KEYS.apiKey);
        if (!key) throw new Error('No API key');
        return key;
      },
    };
  }

  client(): ResponsesClient {
    return new ResponsesClient(fetcher, this.credentials());
  }

  models(): Promise<ModelInfo[]> {
    return this.client().models();
  }

  /** Picks the first listed model when none has been chosen yet. */
  private async chooseDefaultModel() {
    if (this.state.mode === 'none' || this.state.model) return;
    try {
      const [first] = await this.models();
      if (first) await this.setModel(first.id);
    } catch {
      // Left unset; assistant settings lets the person choose or type one.
    }
  }

  async signInWithChatGpt() {
    const { email } = await chatGptAuth.signIn();
    await secrets.remove(KEYS.apiKey);
    this.set({ mode: 'chatgpt', email, model: await secrets.get(KEYS.model) });
    await this.chooseDefaultModel();
  }

  async useApiKey(key: string) {
    await chatGptAuth.signOut();
    await secrets.set(KEYS.apiKey, key.trim());
    await secrets.remove(KEYS.model);
    this.set({ mode: 'api_key', model: null });
    // Listing models also proves the key works.
    const [first] = await this.models();
    if (first) await this.setModel(first.id);
  }

  async setModel(model: string) {
    await secrets.set(KEYS.model, model);
    if (this.state.mode !== 'none') this.set({ ...this.state, model });
  }

  async disconnect() {
    await chatGptAuth.signOut();
    await secrets.remove(KEYS.apiKey);
    await secrets.remove(KEYS.model);
    this.set({ mode: 'none' });
  }
}

export const connection = new AssistantConnection();
