/** A minimal streaming client for the OpenAI Responses API. */

export const API_BASE_URL = 'https://api.openai.com/v1';
export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

export interface Credentials {
  /** A bearer token: a ChatGPT plan access token or an API key. */
  token(options?: { forceRefresh?: boolean }): Promise<string>;
  /** True when requests are paid for by the person's ChatGPT plan. */
  planUsage: boolean;
}

export type OutputItem =
  | { type: 'message'; role: 'assistant'; content: { type: string; text?: string }[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'reasoning'; [key: string]: unknown };

export type InputItem =
  | OutputItem
  | { role: 'user'; content: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export class AssistantError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message);
    this.name = 'AssistantError';
  }
}

/** Plan usage problems, in words; see "Errors and recovery" in the Sign in with ChatGPT docs. */
const PLAN_ERRORS: Record<string, string> = {
  subscription_sharing_user_not_eligible: 'This ChatGPT account cannot share its plan with apps (it needs Plus or Pro).',
  subscription_sharing_usage_limit_exceeded: `You have reached your ChatGPT plan's usage limit for now. Manage usage at ${MANAGE_USAGE_URL}`,
  subscription_sharing_usage_unavailable: `ChatGPT plan usage is not available right now. Check ${MANAGE_USAGE_URL}`,
  subscription_sharing_unsupported_capability: 'Your ChatGPT plan does not support something this request needs.',
};

function errorFrom(error: { code?: string; message?: string } | null | undefined, status?: number): AssistantError {
  const known = error?.code ? PLAN_ERRORS[error.code] : undefined;
  const message = known ?? error?.message ?? (status ? `The request failed (${status})` : 'The model returned an error');
  return new AssistantError(message, error?.code, status);
}

/** Yields the JSON payload of each server-sent event, however the bytes are chunked. */
export async function* sseEvents(response: Response): AsyncGenerator<Record<string, any>> {
  const parse = function* (block: string) {
    const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (data && data !== '[DONE]') yield JSON.parse(data) as Record<string, any>;
  };
  const reader = response.body?.getReader?.();
  if (!reader) {
    // No streaming body here: read it whole.
    for (const block of (await response.text()).split(/\r?\n\r?\n/)) yield* parse(block);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = done ? '' : blocks.pop()!;
    for (const block of blocks) yield* parse(block);
    if (done) return;
  }
}

export interface ModelInfo {
  id: string;
  name: string;
}

export class ResponsesClient {
  /** Set once a server has refused encrypted reasoning, so it is not asked for again. */
  private plainReasoning = false;

  constructor(private fetcher: typeof fetch, private credentials: Credentials, private baseUrl = API_BASE_URL) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    const send = async (forceRefresh: boolean) =>
      this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await this.credentials.token({ forceRefresh })}` },
      });
    let response: Response;
    try {
      response = await send(false);
      // A rejected token may simply have expired: refresh it and try once more.
      if (response.status === 401) response = await send(true);
    } catch (error) {
      if (error instanceof AssistantError) throw error;
      throw new AssistantError('Could not reach OpenAI. Check your connection and try again.', 'network');
    }
    return response;
  }

  private static async failure(response: Response): Promise<AssistantError> {
    const body = await response.text().catch(() => '');
    let parsed: any = null;
    try {
      parsed = JSON.parse(body);
    } catch {}
    const error = parsed?.error ?? (parsed?.code ? parsed : null) ?? { message: body.slice(0, 200) || undefined };
    if (response.status === 401) return new AssistantError('OpenAI did not accept the sign-in. Connect again in assistant settings.', 'unauthorized', 401);
    return Object.assign(errorFrom(error, response.status), { param: error?.param });
  }

  /**
   * Runs one model turn and returns its output items. Nothing is stored by OpenAI
   * (`store: false`); the conversation is replayed from this device each time.
   */
  async respond(
    request: { model: string; instructions: string; input: InputItem[]; tools: unknown[] },
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<OutputItem[]> {
    const body = () => ({
      ...request,
      input: this.plainReasoning ? request.input.filter((item) => !('type' in item && item.type === 'reasoning')) : request.input,
      store: false,
      stream: true,
      ...(this.plainReasoning ? {} : { include: ['reasoning.encrypted_content'] }),
    });
    const open = () =>
      this.request('/responses', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body()),
      });
    let response = await open();
    if (!response.ok) {
      const failure = await ResponsesClient.failure(response);
      const refusedInclude = response.status === 400 && !this.plainReasoning &&
        ((failure as { param?: string }).param === 'include' || /include|encrypted/i.test(failure.message));
      if (!refusedInclude) throw failure;
      this.plainReasoning = true;
      response = await open();
      if (!response.ok) throw await ResponsesClient.failure(response);
    }

    const items: OutputItem[] = [];
    let completed = false;
    for await (const event of sseEvents(response)) {
      switch (event.type) {
        case 'response.output_text.delta':
          if (event.delta) onText(event.delta);
          break;
        case 'response.output_item.done':
          if (event.item) items.push(event.item);
          break;
        case 'response.completed':
          completed = true;
          break;
        case 'response.incomplete':
          throw new AssistantError('The answer was cut short. Try asking again, perhaps in smaller steps.', 'incomplete');
        case 'response.failed':
          throw errorFrom(event.response?.error);
        case 'error':
          throw errorFrom(event.error ?? event);
      }
    }
    if (!completed) throw new AssistantError('The connection dropped before the answer finished. Try again.', 'interrupted');
    return items;
  }

  /** Models this credential can use. A plan token and an API key answer in different shapes. */
  async models(): Promise<ModelInfo[]> {
    const response = await this.request('/models', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) throw await ResponsesClient.failure(response);
    const parsed = await response.json();
    if (Array.isArray(parsed?.models)) {
      return parsed.models
        .filter((model: any) => model?.slug && (model.visibility === undefined || model.visibility === 'list'))
        .map((model: any) => ({ id: model.slug, name: model.display_name ?? model.slug }));
    }
    if (Array.isArray(parsed?.data)) {
      const other = /audio|realtime|image|tts|transcribe|whisper|embedding|moderation|search|dall|sora|codex|instruct|babbage|davinci/;
      return parsed.data
        .filter((model: any) => typeof model?.id === 'string' && /^(gpt|o\d|chatgpt)/.test(model.id) && !other.test(model.id))
        .sort((a: any, b: any) => (b.created ?? 0) - (a.created ?? 0))
        .map((model: any) => ({ id: model.id, name: model.id }));
    }
    throw new AssistantError('OpenAI did not return a list of models.');
  }
}
