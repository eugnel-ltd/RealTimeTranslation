import type { WorkerEnv } from './env';
import { errorJson, logError, readJson } from './http';
import { isProfileId, kvProfileLoader, type ProfileLoader } from './profiles';

export type AnswerLanguage = 'same' | 'en' | 'yue' | 'zh-CN';

export type AnswerBody = {
  conversation?: string;
  question?: string;
  previousQuestion?: string;
  answerLanguage?: AnswerLanguage;
  userContext?: string;
  extraNotes?: string;
  cvBackground?: string;
  profileId?: string;
  model?: string;
  force?: boolean;
};

export type SystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

const ALLOWED_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

function languageInstruction(lang: AnswerLanguage | undefined): string {
  switch (lang) {
    case 'en':
      return 'Write the answer in English.';
    case 'yue':
      return 'Write the answer in Hong Kong Cantonese using Traditional Chinese characters (粵語書面/口語混合，繁體).';
    case 'zh-CN':
      return 'Write the answer in Mandarin Simplified Chinese (普通话，简体).';
    default:
      return 'Write the answer in the same language as the question.';
  }
}

export function buildAnswerSystemBlocks(opts: {
  answerLanguage?: AnswerLanguage;
  userContext?: string;
  extraNotes?: string;
  profileName?: string;
  profileMarkdown?: string;
  knownQuestion: boolean;
}): SystemBlock[] {
  const questionBit = opts.knownQuestion
    ? 'The interview question is already extracted. Answer only that question as the candidate would. Do not repeat the question. Do not add a preamble.'
    : [
        'From the transcript, extract the most recent interview question asked by the other party (not the candidate).',
        'First line MUST be exactly: <<<QUESTION>>>the question text<<<END>>>',
        'Then write the candidate answer only. If there is no interview question, output <<<QUESTION>>><<<END>>> and nothing else.',
      ].join(' ');

  const staticText = [
    'You are an interview copilot. Speak as the candidate in a live interview.',
    'Give a confident, concise spoken-style answer the candidate can say aloud immediately.',
    'Behavioural questions: STAR (Situation, Task, Action, Result) in short spoken sentences.',
    'Other questions: 3–5 spoken key points.',
    'Use the candidate profile and notes below. Ground every specific claim there.',
    'Do not invent employers, dates, titles, or metrics.',
    'Do not refuse with hedges such as "I don\'t want to invent specifics" or "I don\'t have enough information".',
    'If a needed fact is truly missing from the profile and notes, keep a usable spoken answer and mark only that fact in a brief bracket like [team size]. Never pad the answer with placeholders.',
    languageInstruction(opts.answerLanguage),
  ].join('\n');

  const blocks: SystemBlock[] = [{ type: 'text', text: staticText }];
  const profile = opts.profileMarkdown?.trim();
  if (profile) {
    blocks.push({
      type: 'text',
      text: `Candidate profile (${opts.profileName || 'selected'}):\n${profile}`,
      cache_control: { type: 'ephemeral' },
    });
  }
  blocks.push({
    type: 'text',
    text: [
      `Candidate context (role / notes):\n${opts.userContext?.trim() || '(none)'}`,
      `Extra notes:\n${opts.extraNotes?.trim() || '(none)'}`,
      questionBit,
    ].join('\n'),
  });
  return blocks;
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function shouldSkipAnswer(previousQuestion: string | undefined, question: string | undefined, force: boolean): boolean {
  if (force) return false;
  if (!question) return true;
  if (!previousQuestion) return false;
  return normalizeQuestion(previousQuestion) === normalizeQuestion(question);
}

export async function handleAnswer(
  request: Request,
  env: WorkerEnv,
  fetchImpl: typeof fetch = fetch,
  loader: ProfileLoader = kvProfileLoader(env.PROFILES),
): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) return errorJson('ANTHROPIC_API_KEY is not configured', 503);

  const body = await readJson<AnswerBody>(request);
  const conversation = (body.conversation ?? '').trim();
  if (!conversation && !body.question) return errorJson('conversation or question is required', 400);

  const profileId = body.profileId?.trim() ?? '';
  if (profileId && !isProfileId(profileId)) return errorJson('Unknown profile id', 400);

  const model = body.model && ALLOWED_MODELS.has(body.model)
    ? body.model
    : env.DEFAULT_ANSWER_MODEL || 'claude-opus-5-5';

  const knownQuestion = (body.question ?? '').trim();
  if (shouldSkipAnswer(body.previousQuestion, knownQuestion || undefined, Boolean(body.force))) {
    return sseResponse(
      encodeSse('skip', { reason: 'no_new_question' }) + encodeSse('done', {}),
    );
  }

  const profile = profileId ? await loader.get(profileId) : null;
  const extraNotes = body.extraNotes ?? body.cvBackground;
  const system = buildAnswerSystemBlocks({
    answerLanguage: body.answerLanguage,
    userContext: body.userContext,
    extraNotes,
    profileName: profile?.name,
    profileMarkdown: profile?.markdown,
    knownQuestion: Boolean(knownQuestion),
  });

  const user = knownQuestion
    ? `Question:\n${knownQuestion}\n\nRecent transcript:\n${conversation}`
    : `Recent transcript:\n${conversation}`;

  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      stream: true,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok || !res.body) {
    const errBody = await res.text();
    logError({ message: 'anthropic messages failed', status: res.status, body: errBody.slice(0, 400) });
    return errorJson('Anthropic request failed', 502, { status: res.status });
  }

  return sseResponse(relayAnthropicStream(res.body, knownQuestion));
}

function sseResponse(body: ReadableStream<Uint8Array> | string): Response {
  return new Response(typeof body === 'string' ? body : body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function relayAnthropicStream(body: ReadableStream<Uint8Array>, knownQuestion: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let questionEmitted = Boolean(knownQuestion);
  let preamble = '';
  let usage: Record<string, number> = {};

  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(encodeSse(event, data)));
      if (knownQuestion) send('question', { question: knownQuestion });

      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            const payload = dataLine.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            let parsed: {
              type?: string;
              delta?: { type?: string; text?: string };
              message?: { usage?: Record<string, number> };
              usage?: Record<string, number>;
            };
            try {
              parsed = JSON.parse(payload) as typeof parsed;
            } catch {
              continue;
            }
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              usage = { ...usage, ...parsed.message.usage };
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              usage = { ...usage, ...parsed.usage };
            }
            if (parsed.type !== 'content_block_delta' || parsed.delta?.type !== 'text_delta' || !parsed.delta.text) {
              continue;
            }
            const piece = parsed.delta.text;
            if (questionEmitted) {
              send('token', { text: piece });
              continue;
            }
            raw += piece;
            const match = raw.match(/<<<QUESTION>>>([\s\S]*?)<<<END>>>/);
            if (match) {
              const question = match[1].trim();
              questionEmitted = true;
              send('question', { question });
              const rest = raw.slice(match.index! + match[0].length);
              if (rest) send('token', { text: rest });
            } else if (raw.length > 400 && !raw.includes('<<<QUESTION>>>')) {
              questionEmitted = true;
              send('question', { question: '' });
              send('token', { text: raw });
            } else {
              preamble = raw;
            }
          }
        }
        if (!questionEmitted && preamble) {
          send('question', { question: '' });
          send('token', { text: preamble });
        }
        if (Object.keys(usage).length) send('usage', usage);
        send('done', {});
        controller.close();
      } catch (err) {
        send('error', { error: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });
}
