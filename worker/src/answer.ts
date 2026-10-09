import type { WorkerEnv } from './env';
import { errorJson, logError, readJson } from './http';

export type AnswerLanguage = 'same' | 'en' | 'yue' | 'zh-CN';

export type AnswerBody = {
  conversation?: string;
  question?: string;
  previousQuestion?: string;
  answerLanguage?: AnswerLanguage;
  userContext?: string;
  cvBackground?: string;
  model?: string;
  force?: boolean;
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

export function buildAnswerSystem(opts: {
  answerLanguage?: AnswerLanguage;
  userContext?: string;
  cvBackground?: string;
  knownQuestion: boolean;
}): string {
  const context = opts.userContext?.trim() || '(none)';
  const cv = opts.cvBackground?.trim() || '(none)';
  const questionBit = opts.knownQuestion
    ? 'The interview question is already extracted. Answer only that question as the candidate would. Do not repeat the question. Do not add a preamble.'
    : [
        'From the transcript, extract the most recent interview question asked by the other party (not the candidate).',
        'First line MUST be exactly: <<<QUESTION>>>the question text<<<END>>>',
        'Then write the candidate answer only. If there is no interview question, output <<<QUESTION>>><<<END>>> and nothing else.',
      ].join(' ');

  return [
    'You are an interview copilot. Speak as the candidate in a live interview.',
    'Give a confident, concise spoken-style answer the candidate can say aloud immediately.',
    'Behavioural questions: STAR (Situation, Task, Action, Result) in short spoken sentences.',
    'Other questions: 3–5 spoken key points.',
    'Use the candidate context and CV/background below. Ground every specific claim there.',
    'Do not invent employers, dates, titles, or metrics.',
    'Do not refuse with hedges such as "I don\'t want to invent specifics" or "I don\'t have enough information".',
    'If a needed fact is truly missing from context and CV, keep a usable spoken answer and mark only that fact in a brief bracket like [team size]. Never pad the answer with placeholders.',
    languageInstruction(opts.answerLanguage),
    `Candidate context (role / notes):\n${context}`,
    `CV / background:\n${cv}`,
    questionBit,
  ].join('\n');
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
): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) return errorJson('ANTHROPIC_API_KEY is not configured', 503);

  const body = await readJson<AnswerBody>(request);
  const conversation = (body.conversation ?? '').trim();
  if (!conversation && !body.question) return errorJson('conversation or question is required', 400);

  const model = body.model && ALLOWED_MODELS.has(body.model)
    ? body.model
    : env.DEFAULT_ANSWER_MODEL || 'claude-opus-5-5';

  const knownQuestion = (body.question ?? '').trim();
  if (shouldSkipAnswer(body.previousQuestion, knownQuestion || undefined, Boolean(body.force))) {
    return sseResponse(
      encodeSse('skip', { reason: 'no_new_question' }) + encodeSse('done', {}),
    );
  }

  const system = buildAnswerSystem({
    answerLanguage: body.answerLanguage,
    userContext: body.userContext,
    cvBackground: body.cvBackground,
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
            let parsed: { type?: string; delta?: { type?: string; text?: string } };
            try {
              parsed = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } };
            } catch {
              continue;
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
        send('done', {});
        controller.close();
      } catch (err) {
        send('error', { error: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });
}
