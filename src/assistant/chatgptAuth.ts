import { API_BASE_URL } from './responses';

/**
 * Sign in with ChatGPT for open-source apps: lets a ChatGPT Plus or Pro subscriber spend
 * their plan's allowance on the Responses API instead of an API key.
 * https://developers.openai.com/siwc/token-sharing-open-source
 *
 * - Registration is dynamic: the first sign-in uses `client_id=dynamic_agent_client` and
 *   OpenAI issues a client ID bound to the person, which every later request must use.
 * - The redirect must be an HTTP loopback URL (http://127.0.0.1:<port>/auth/callback),
 *   so the platform supplies a `LoopbackBrowser` that listens there during sign-in.
 * - Tokens are kept in the device's secure storage and nowhere else.
 */

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const CONFIGURATION_URL = `${ISSUER}/.well-known/openid-configuration`;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
/** The scope that bills requests to the ChatGPT plan; the consent screen can decline it. */
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const APP_NAME = 'pf-mobile';
export const CALLBACK_PATH = '/auth/callback';
const REFRESH_EARLY_MS = 2 * 60_000;

const KEYS = { credentials: 'chatgpt_credentials', clientId: 'chatgpt_client_id', hostId: 'chatgpt_host_id' };

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface LoopbackBrowser {
  /** False where the platform cannot listen on a loopback port (Expo Go, web). */
  available(): boolean;
  /**
   * Starts a listener on 127.0.0.1, opens `authorizeUrl(redirectUri)` in the system
   * browser and resolves with the full callback URL the browser was sent to.
   */
  authorize(authorizeUrl: (redirectUri: string) => string): Promise<string>;
}

export interface AuthPlatform {
  secrets: SecretStore;
  browser: LoopbackBrowser;
  fetch: typeof fetch;
  /** Random bytes, base64url encoded. */
  randomToken(): Promise<string>;
  /** SHA-256 of some text, base64url encoded. */
  sha256(text: string): Promise<string>;
  newId(): string;
}

export type AuthErrorCode =
  | 'unavailable' | 'cancelled' | 'denied' | 'plan_usage_not_granted' | 'invalid_response'
  | 'signed_out' | 'network' | 'not_eligible' | 'invalid_grant';

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

interface StoredCredentials {
  email: string;
  client_id: string;
  access_token: string;
  refresh_token: string;
  /** Epoch milliseconds. */
  expires_at: number;
}

const form = (params: Record<string, string>) =>
  Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');

function query(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of (url.split('?')[1]?.split('#')[0] ?? '').split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return params;
}

function jwtClaims(token: string): Record<string, any> | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='));
    return JSON.parse(decodeURIComponent(Array.from(binary, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
  } catch {
    return null;
  }
}

export class ChatGptAuth {
  private credentials: StoredCredentials | null | undefined;
  /** Refresh tokens rotate, so two refreshes at once would invalidate each other. */
  private refreshing: Promise<StoredCredentials> | null = null;

  constructor(private platform: AuthPlatform) {}

  available(): boolean {
    return this.platform.browser.available();
  }

  private async load(): Promise<StoredCredentials | null> {
    if (this.credentials === undefined) {
      const stored = await this.platform.secrets.get(KEYS.credentials).catch(() => null);
      try {
        this.credentials = stored ? JSON.parse(stored) : null;
      } catch {
        this.credentials = null;
      }
    }
    return this.credentials!;
  }

  private async save(credentials: StoredCredentials) {
    this.credentials = credentials;
    await this.platform.secrets.set(KEYS.credentials, JSON.stringify(credentials));
  }

  async account(): Promise<{ email: string } | null> {
    const credentials = await this.load();
    return credentials ? { email: credentials.email } : null;
  }

  private async post(url: string, params: Record<string, string>) {
    let response: Response;
    try {
      response = await this.platform.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form(params),
      });
    } catch {
      throw new AuthError('network', 'Could not reach ChatGPT. Check your connection and try again.');
    }
    const text = await response.text().catch(() => '');
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error_description: text.slice(0, 200) };
    }
    return { ok: response.ok, status: response.status, data };
  }

  /**
   * Runs the browser sign-in and stores the tokens. An ineligible plan (ChatGPT Free)
   * shows up as a refused code exchange followed by a consent screen that can only be
   * cancelled, so that sequence is reported as `not_eligible`.
   */
  async signIn(): Promise<{ email: string }> {
    if (!this.available()) {
      throw new AuthError('unavailable', 'Sign in with ChatGPT needs the installed app; it cannot run in Expo Go or a browser.');
    }
    try {
      return await this.authorizeOnce();
    } catch (error) {
      if (!(error instanceof AuthError) || error.code !== 'invalid_grant') throw error;
      try {
        return await this.authorizeOnce();
      } catch (retry) {
        if (retry instanceof AuthError && (retry.code === 'denied' || retry.code === 'invalid_grant' || retry.code === 'cancelled')) {
          throw new AuthError('not_eligible', 'This ChatGPT account cannot share its plan with apps. That needs ChatGPT Plus or Pro.');
        }
        throw retry;
      }
    }
  }

  private async authorizeOnce(): Promise<{ email: string }> {
    const { secrets } = this.platform;
    let hostId = await secrets.get(KEYS.hostId);
    if (!hostId) {
      hostId = `urn:uuid:${this.platform.newId()}`;
      await secrets.set(KEYS.hostId, hostId);
    }
    const registered = await secrets.get(KEYS.clientId);
    const [verifier, state, nonce] = await Promise.all([1, 2, 3].map(() => this.platform.randomToken()));
    const challenge = await this.platform.sha256(verifier);
    let redirectUri = '';

    const callbackUrl = await this.platform.browser.authorize((uri) => {
      redirectUri = uri;
      return `${AUTHORIZE_URL}?${form({
        client_id: registered ?? DYNAMIC_CLIENT_ID,
        // Only the first registration names the app.
        ...(registered ? {} : { agent_name_hint: APP_NAME }),
        ext_agent_host_id: hostId!,
        response_type: 'code',
        redirect_uri: uri,
        scope: SCOPES,
        resource: API_BASE_URL,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: challenge,
      })}`;
    });

    const callback = query(callbackUrl);
    if (callback.state !== state) throw new AuthError('invalid_response', 'The sign-in response did not match this request.');
    if (callback.error) {
      if (callback.error === 'access_denied') throw new AuthError('denied', 'Access was declined.');
      throw new AuthError('invalid_response', callback.error_description || callback.error);
    }
    const clientId = callback.client_id ?? registered;
    if (!callback.code || !clientId || clientId === DYNAMIC_CLIENT_ID) {
      throw new AuthError('invalid_response', 'ChatGPT did not finish registering the app. Try again.');
    }
    // Kept before the one-time exchange, so a failed exchange retries with it.
    await secrets.set(KEYS.clientId, clientId);

    const { ok, data } = await this.post(TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code: callback.code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: API_BASE_URL,
    });
    if (!ok && data?.error === 'invalid_grant') {
      if (registered) await secrets.remove(KEYS.clientId);
      throw new AuthError('invalid_grant', data?.error_description || 'invalid_grant');
    }
    if (!ok || !data?.access_token || !data?.refresh_token || !data?.id_token) {
      throw new AuthError('invalid_response', data?.error_description || data?.error || 'ChatGPT did not return tokens.');
    }

    // The ID token came straight from the token endpoint over TLS in answer to our own
    // exchange, which OpenID Connect accepts in place of checking its signature; its
    // issuer, audience, nonce and expiry are still checked.
    const claims = jwtClaims(data.id_token);
    const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    if (!claims || claims.iss !== ISSUER || !audiences.includes(clientId) || claims.nonce !== nonce ||
        (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now())) {
      throw new AuthError('invalid_response', 'ChatGPT returned a sign-in that does not match this request.');
    }
    const scopes = String(data.scope ?? callback.scope ?? '').split(/\s+/);
    if (!scopes.includes(PLAN_SCOPE)) {
      throw new AuthError('plan_usage_not_granted', 'Using your ChatGPT plan was not allowed during sign-in, so the assistant cannot use it.');
    }
    const email = claims.email ?? claims['https://api.openai.com/profile']?.email ?? '';
    await this.save({
      email,
      client_id: clientId,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    });
    return { email };
  }

  /** A valid access token, refreshed first when it is about to expire. */
  async accessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    const credentials = await this.load();
    if (!credentials) throw new AuthError('signed_out', 'Sign in with ChatGPT to use the assistant.');
    if (!options.forceRefresh && credentials.expires_at - REFRESH_EARLY_MS > Date.now()) return credentials.access_token;
    this.refreshing ??= this.refresh(credentials).finally(() => {
      this.refreshing = null;
    });
    return (await this.refreshing).access_token;
  }

  private async refresh(credentials: StoredCredentials): Promise<StoredCredentials> {
    const { ok, status, data } = await this.post(TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: credentials.client_id,
      refresh_token: credentials.refresh_token,
      resource: API_BASE_URL,
    });
    if (!ok || !data?.access_token) {
      if (status === 400 || status === 401 || data?.error === 'invalid_grant') {
        await this.forget();
        throw new AuthError('signed_out', 'Your ChatGPT session has ended. Sign in again to keep using the assistant.');
      }
      throw new AuthError('network', data?.error_description || `Could not refresh the ChatGPT session (${status}).`);
    }
    const next = {
      ...credentials,
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? credentials.refresh_token,
      expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    };
    await this.save(next);
    return next;
  }

  private async forget() {
    this.credentials = null;
    await this.platform.secrets.remove(KEYS.credentials);
  }

  /** Revokes the refresh token (best effort) and forgets the session. */
  async signOut() {
    const credentials = await this.load();
    await this.forget();
    if (!credentials) return;
    try {
      const configuration = await (await this.platform.fetch(CONFIGURATION_URL)).json();
      if (configuration?.revocation_endpoint) {
        await this.post(configuration.revocation_endpoint, {
          token: credentials.refresh_token, token_type_hint: 'refresh_token', client_id: credentials.client_id,
        });
      }
    } catch {}
  }
}
