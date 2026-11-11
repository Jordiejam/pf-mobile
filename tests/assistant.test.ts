import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Assistant } from '../src/assistant/agent';
import { AuthError, ChatGptAuth, type AuthPlatform } from '../src/assistant/chatgptAuth';
import { AssistantError, ResponsesClient, sseEvents, type OutputItem } from '../src/assistant/responses';
import { AssistantTools } from '../src/assistant/tools';
import { testLedger } from './helpers';

const sse = (events: object[]) => events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join('');

/** A streaming body split at awkward places, as a network would. */
function streamed(text: string, chunk = 7): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, (offset += chunk)));
    },
  });
  return new Response(body, { status: 200 });
}

const turn = (items: OutputItem[], text = '') =>
  streamed(sse([
    ...(text ? [{ type: 'response.output_text.delta', delta: text }] : []),
    ...items.map((item) => ({ type: 'response.output_item.done', item })),
    { type: 'response.completed' },
  ]));

const call = (name: string, args: object, id = name): OutputItem => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
const message = (text: string): OutputItem => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

/** A fake API that answers each request with the next scripted turn and records the bodies. */
function scripted(turns: (() => Response)[]) {
  const requests: any[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    requests.push({ headers: init.headers, body: init.body ? JSON.parse(String(init.body)) : null });
    return turns.shift()!();
  }) as unknown as typeof fetch;
  const client = new ResponsesClient(fetcher, { token: async () => 'secret-token', planUsage: true });
  return { client, requests };
}

describe('server-sent events', () => {
  it('reassembles events across arbitrary chunk boundaries', async () => {
    const events = [];
    for await (const event of sseEvents(streamed(sse([{ a: 1 }, { b: 'two\nlines' }]) + 'data: [DONE]\n\n', 3))) events.push(event);
    expect(events).toEqual([{ a: 1 }, { b: 'two\nlines' }]);
  });
});

describe('assistant conversation', () => {
  it('reads, proposes, and saves only when the person approves', async () => {
    const { ledger, account, category, balance } = testLedger();
    const current = account('Current', 10_000);
    const assistant = new Assistant(ledger);
    const change = { action: 'create', kind: 'expense', account_id: current.id, category_id: category('expense', 'Groceries').id, amount: '12.50', occurred_at: '2026-11-10T13:00:00Z', note: 'Tesco' };
    const { client, requests } = scripted([
      () => turn([call('get_reference_data', {})]),
      () => turn([call('propose_changes', { changes: [change] })]),
      () => turn([message('I have proposed £12.50 at Tesco.')], 'I have proposed £12.50 at Tesco.'),
    ]);

    await assistant.send('spent 12.50 at tesco yesterday', client, 'test-model');

    expect(requests).toHaveLength(3);
    expect(requests[0].headers.Authorization).toBe('Bearer secret-token');
    expect(requests[0].body).toMatchObject({ model: 'test-model', store: false, stream: true });
    // The model's own tool list has no way to commit.
    expect(requests[0].body.tools.map((tool: any) => tool.name)).not.toContain('commit_changes');
    // Each tool call is answered in the next request.
    const outputs = requests[2].body.input.filter((item: any) => item.type === 'function_call_output');
    expect(outputs).toHaveLength(2);
    expect(JSON.parse(outputs[0].output).accounts[0]).toMatchObject({ name: 'Current', balance: '100.00' });
    expect(JSON.parse(outputs[1].output)).toMatchObject({ shown_to_user: true, saved: false });

    const proposal = assistant.items.find((item) => item.type === 'proposal')!;
    expect(proposal).toMatchObject({ status: 'pending' });
    expect(assistant.items.at(-1)).toMatchObject({ type: 'assistant', text: 'I have proposed £12.50 at Tesco.' });
    // Nothing is saved until the tap.
    expect(balance(current.id)).toBe(10_000);
    assistant.approve(proposal.id);
    expect(balance(current.id)).toBe(8_750);
    expect(assistant.items.find((item) => item.type === 'proposal')).toMatchObject({ status: 'saved' });
    assistant.approve(proposal.id);
    expect(balance(current.id)).toBe(8_750);
  });

  it('returns problems to the model without showing a proposal', async () => {
    const { ledger, account } = testLedger();
    const current = account('Current');
    const assistant = new Assistant(ledger);
    const { client, requests } = scripted([
      () => turn([call('propose_changes', { changes: [{ action: 'create', kind: 'expense', account_id: current.id, amount: '5', occurred_at: '2026-11-10T13:00:00Z' }] })]),
      () => turn([message('Which category?')], 'Which category?'),
    ]);
    await assistant.send('spent a fiver', client, 'm');
    const output = JSON.parse(requests[1].body.input.at(-1).output);
    expect(output).toMatchObject({ shown_to_user: false, problems: [{ index: 0, message: 'Choose a category' }] });
    expect(assistant.items.some((item) => item.type === 'proposal')).toBe(false);
  });

  it('a discarded proposal saves nothing and tells the model', async () => {
    const { ledger, account, category, balance } = testLedger();
    const current = account('Current', 1_000);
    const assistant = new Assistant(ledger);
    const change = { action: 'create', kind: 'expense', account_id: current.id, category_id: category('expense', 'Groceries').id, amount: '1', occurred_at: '2026-11-10T13:00:00Z' };
    const { client, requests } = scripted([
      () => turn([call('propose_changes', { changes: [change] })]),
      () => turn([message('Proposed.')]),
      () => turn([message('OK.')]),
    ]);
    await assistant.send('one pound', client, 'm');
    const proposal = assistant.items.find((item) => item.type === 'proposal')!;
    assistant.discard(proposal.id);
    assistant.approve(proposal.id);
    expect(balance(current.id)).toBe(1_000);
    await assistant.send('thanks', client, 'm');
    expect(requests[2].body.input.some((item: any) => typeof item.content === 'string' && item.content.startsWith('[app] The user discarded'))).toBe(true);
  });

  it('survives hostile tool arguments', () => {
    const { ledger } = testLedger();
    const tools = new AssistantTools(ledger, () => {});
    expect(tools.call('get_transaction', '{"id": "x\' OR 1=1 --"}')).toEqual({ error: 'Transaction not found' });
    expect(tools.call('propose_changes', '{"changes": "DROP TABLE"}')).toEqual({ error: 'Send at least one change' });
    expect(tools.call('search_transactions', 'not json')).toEqual({ error: 'The arguments were not valid JSON' });
    expect(tools.call('delete_everything', '{}')).toEqual({ error: 'Unknown tool delete_everything' });
  });

  it('reports API failures in words and keeps the conversation usable', async () => {
    const { ledger } = testLedger();
    const assistant = new Assistant(ledger);
    const limit = () => new Response(JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'x' } }), { status: 429 });
    const { client, requests } = scripted([limit, () => turn([message('Hello')], 'Hello')]);
    await assistant.send('hi', client, 'm');
    expect(assistant.items.at(-1)).toMatchObject({ type: 'error' });
    expect((assistant.items.at(-1) as any).text).toContain('usage limit');
    await assistant.send('hi again', client, 'm');
    // The failed message stays in the conversation, as it does on screen.
    expect(requests[1].body.input).toEqual([{ role: 'user', content: 'hi' }, { role: 'user', content: 'hi again' }]);
    expect(assistant.busy).toBe(false);
  });
});

describe('model client', () => {
  it('refreshes the token once on 401', async () => {
    const tokens: boolean[] = [];
    let first = true;
    const fetcher = (async () => {
      if (first) return (first = false), new Response('', { status: 401 });
      return turn([message('ok')]);
    }) as unknown as typeof fetch;
    const client = new ResponsesClient(fetcher, { planUsage: true, token: async (options) => (tokens.push(!!options?.forceRefresh), 't') });
    await client.respond({ model: 'm', instructions: '', input: [], tools: [] }, () => {});
    expect(tokens).toEqual([false, true]);
  });

  it('fails clearly when a stream ends early', async () => {
    const fetcher = (async () => streamed(sse([{ type: 'response.output_text.delta', delta: 'par' }]))) as unknown as typeof fetch;
    const client = new ResponsesClient(fetcher, { planUsage: false, token: async () => 't' });
    await expect(client.respond({ model: 'm', instructions: '', input: [], tools: [] }, () => {})).rejects.toBeInstanceOf(AssistantError);
  });

  it('lists models from both answer shapes', async () => {
    const answer = (body: object) => new ResponsesClient((async () => new Response(JSON.stringify(body))) as unknown as typeof fetch, { planUsage: true, token: async () => 't' });
    expect(await answer({ models: [{ slug: 'a', display_name: 'A' }, { slug: 'hidden', visibility: 'hide' }] }).models()).toEqual([{ id: 'a', name: 'A' }]);
    expect((await answer({ data: [{ id: 'gpt-x', created: 1 }, { id: 'gpt-y', created: 2 }, { id: 'gpt-audio' }, { id: 'text-embedding-3' }] }).models()).map((model) => model.id)).toEqual(['gpt-y', 'gpt-x']);
  });
});

describe('sign in with ChatGPT', () => {
  const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');
  const idToken = (claims: object) => `${b64('{}')}.${b64(JSON.stringify(claims))}.sig`;

  function platform(overrides: { callback?: (params: URLSearchParams) => Record<string, string>; token?: (params: URLSearchParams) => { status: number; body: object } } = {}) {
    const secrets = new Map<string, string>();
    const tokenRequests: URLSearchParams[] = [];
    let authorize: URLSearchParams | null = null;
    const base: AuthPlatform = {
      secrets: {
        get: async (key) => secrets.get(key) ?? null,
        set: async (key, value) => void secrets.set(key, value),
        remove: async (key) => void secrets.delete(key),
      },
      browser: {
        available: () => true,
        authorize: async (build) => {
          const url = build('http://127.0.0.1:5555/auth/callback');
          authorize = new URL(url).searchParams;
          const extra = overrides.callback?.(authorize) ?? { code: 'the-code', client_id: 'oaiapp_issued', state: authorize.get('state')! };
          return `http://127.0.0.1:5555/auth/callback?${new URLSearchParams(extra)}`;
        },
      },
      fetch: (async (url: string, init?: RequestInit) => {
        if (String(url).includes('openid-configuration')) return new Response('{}');
        const params = new URLSearchParams(String(init?.body));
        tokenRequests.push(params);
        const custom = overrides.token?.(params);
        if (custom) return new Response(JSON.stringify(custom.body), { status: custom.status });
        const refresh = params.get('grant_type') === 'refresh_token';
        return new Response(JSON.stringify({
          access_token: refresh ? 'access-2' : 'access-1', refresh_token: refresh ? 'refresh-2' : 'refresh-1', expires_in: 3600,
          scope: 'openid chatgpt.tokens.use.direct',
          id_token: idToken({ iss: 'https://auth.openai.com', aud: params.get('client_id'), nonce: authorize!.get('nonce'), exp: Date.now() / 1000 + 600, email: 'person@example.com' }),
        }));
      }) as unknown as typeof fetch,
      randomToken: async () => b64(randomBytes(32)),
      sha256: async (text) => b64(createHash('sha256').update(text).digest()),
      newId: randomUUID,
    };
    return { base, secrets, tokenRequests, authorize: () => authorize! };
  }

  it('registers, exchanges the code with PKCE and stores tokens only in secure storage', async () => {
    const { base, secrets, tokenRequests, authorize } = platform();
    const auth = new ChatGptAuth(base);
    expect(await auth.signIn()).toEqual({ email: 'person@example.com' });

    const sent = authorize();
    expect(sent.get('client_id')).toBe('dynamic_agent_client');
    expect(sent.get('redirect_uri')).toBe('http://127.0.0.1:5555/auth/callback');
    expect(sent.get('resource')).toBe('https://api.openai.com/v1');
    expect(sent.get('code_challenge_method')).toBe('S256');
    const exchange = tokenRequests[0];
    expect(exchange.get('client_id')).toBe('oaiapp_issued');
    expect(b64(createHash('sha256').update(exchange.get('code_verifier')!).digest())).toBe(sent.get('code_challenge'));
    expect(secrets.get('chatgpt_client_id')).toBe('oaiapp_issued');
    expect(await auth.accessToken()).toBe('access-1');

    // A forced refresh rotates the refresh token and keeps the replacement.
    expect(await auth.accessToken({ forceRefresh: true })).toBe('access-2');
    expect(tokenRequests[1].get('refresh_token')).toBe('refresh-1');
    expect(JSON.parse(secrets.get('chatgpt_credentials')!).refresh_token).toBe('refresh-2');

    // The next sign-in reuses the issued client.
    await new ChatGptAuth(base).signIn();
    expect(authorize().get('client_id')).toBe('oaiapp_issued');
    expect(authorize().has('agent_name_hint')).toBe(false);

    await auth.signOut();
    expect(secrets.has('chatgpt_credentials')).toBe(false);
    await expect(auth.accessToken()).rejects.toMatchObject({ code: 'signed_out' });
  });

  it('rejects a callback for a different request', async () => {
    const { base, secrets } = platform({ callback: () => ({ code: 'c', client_id: 'oaiapp_x', state: 'forged' }) });
    await expect(new ChatGptAuth(base).signIn()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(secrets.has('chatgpt_credentials')).toBe(false);
  });

  it('refuses a sign-in that did not grant plan usage or has the wrong audience', async () => {
    const noPlan = platform({ token: (params) => ({ status: 200, body: { access_token: 'a', refresh_token: 'r', scope: 'openid', id_token: idToken({ iss: 'https://auth.openai.com', aud: params.get('client_id'), nonce: noPlan.authorize().get('nonce') }) } }) });
    await expect(new ChatGptAuth(noPlan.base).signIn()).rejects.toMatchObject({ code: 'plan_usage_not_granted' });
    const wrong = platform({ token: () => ({ status: 200, body: { access_token: 'a', refresh_token: 'r', scope: 'chatgpt.tokens.use.direct', id_token: idToken({ iss: 'https://auth.openai.com', aud: 'someone-else', nonce: wrong.authorize().get('nonce') }) } }) });
    await expect(new ChatGptAuth(wrong.base).signIn()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(wrong.secrets.has('chatgpt_credentials')).toBe(false);
  });

  it('reports an ineligible plan and signs out when the refresh token is dead', async () => {
    const free = platform({ token: () => ({ status: 400, body: { error: 'invalid_grant' } }) });
    await expect(new ChatGptAuth(free.base).signIn()).rejects.toMatchObject({ code: 'not_eligible' });

    let dead = false;
    const session = platform({ token: () => (dead ? { status: 400, body: { error: 'invalid_grant' } } : (undefined as any)) });
    const auth = new ChatGptAuth(session.base);
    await auth.signIn();
    dead = true;
    await expect(auth.accessToken({ forceRefresh: true })).rejects.toBeInstanceOf(AuthError);
    expect(await auth.account()).toBeNull();
  });
});
