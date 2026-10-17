import { getSessionTemplate, isSessionTemplateId } from '../../shared/sessionTemplates';
import type { WorkerEnv } from './env';
import { errorJson, logError, readJson } from './http';
import { isProfileId, kvProfileLoader, type ProfileLoader } from './profiles';

export type AnswerLanguage = 'same' | 'en' | 'yue' | 'zh-CN';

export type AnswerBody = {
  conversation?: string;
  question?: string;
  /** Fragment from Jev; never treated as the known question. */
  questionHint?: string;
  previousQuestion?: string;
  answerLanguage?: AnswerLanguage;
  userContext?: string;
  extraNotes?: string;
  cvBackground?: string;
  profileId?: string;
  model?: string;
  force?: boolean;
  templateId?: string;
  extractQuestion?: boolean;
  questionTimeLimitSeconds?: number;
};

export type SystemBlock = {
  type: 'text';
  text: string;
};

const ALLOWED_MODELS = new Set(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
const THINKING_HEADROOM_TOKENS = 2048;

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
  templateId?: string;
  extractQuestion?: boolean;
  questionTimeLimitSeconds?: number;
}): SystemBlock[] {
  const template = getSessionTemplate(opts.templateId);
  const extract = Boolean(opts.extractQuestion) && !opts.knownQuestion;
  const questionBit = opts.knownQuestion ? template.prompt.extractKnown : template.prompt.extractUnknown;
  const timeLimit = opts.questionTimeLimitSeconds && opts.questionTimeLimitSeconds > 0
    ? `The candidate has about ${opts.questionTimeLimitSeconds} seconds to speak this answer. Fit the spoken answer in that time.`
    : '';

  const staticText = [
    template.prompt.role,
    template.prompt.answerShape,
    timeLimit,
    languageInstruction(opts.answerLanguage),
    extract
      ? 'When extracting, never truncate the question: keep preamble, context, and all sub-parts.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const blocks: SystemBlock[] = [{ type: 'text', text: staticText }];
  const profile = opts.profileMarkdown?.trim();
  if (profile) {
    blocks.push({
      type: 'text',
      text: `Candidate profile (${opts.profileName || 'selected'}):\n${profile}`,
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

export function shouldSkipAnswer(
  previousQuestion: string | undefined,
  question: string | undefined,
  force: boolean,
  extractQuestion = false,
): boolean {
  if (force) return false;
  if (!question) return !extractQuestion;
  if (!previousQuestion) return false;
  return normalizeQuestion(previousQuestion) === normalizeQuestion(question);
}

export async function handleAnswer(
  request: Request,
  env: WorkerEnv,
  fetchImpl: typeof fetch = fetch,
  loader: ProfileLoader = kvProfileLoader(env.PROFILES),
): Promise<Response> {
  if (!env.GEMINI_API_KEY) return errorJson('GEMINI_API_KEY is not configured', 503);

  const body = await readJson<AnswerBody>(request);
  const conversation = (body.conversation ?? '').trim();
  if (!conversation && !body.question) return errorJson('conversation or question is required', 400);

  const profileId = body.profileId?.trim() ?? '';
  if (profileId && !isProfileId(profileId)) return errorJson('Unknown profile id', 400);

  const model = body.model && ALLOWED_MODELS.has(body.model)
    ? body.model
    : ALLOWED_MODELS.has(env.DEFAULT_ANSWER_MODEL) ? env.DEFAULT_ANSWER_MODEL : 'gemini-3.8-flash';

  const templateId = isSessionTemplateId(body.templateId) ? body.templateId : undefined;
  const template = getSessionTemplate(templateId);
  const knownQuestion = (body.question ?? '').trim();
  const extractQuestion = Boolean(body.extractQuestion) && !knownQuestion;
  const timeLimit = typeof body.questionTimeLimitSeconds === 'number' && body.questionTimeLimitSeconds > 0
    ? Math.min(600, Math.round(body.questionTimeLimitSeconds))
    : undefined;
  if (shouldSkipAnswer(body.previousQuestion, knownQuestion || undefined, Boolean(body.force), extractQuestion)) {
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
    templateId: template.id,
    extractQuestion,
    questionTimeLimitSeconds: timeLimit,
  });

  const hint = body.questionHint?.trim();
  const user = knownQuestion
    ? `Question:\n${knownQuestion}\n\nRecent transcript:\n${conversation || '(none)'}`
    : [
        'Recent transcript (include the full latest question; never truncate):',
        conversation,
        hint ? `\nDetector hint (a fragment only; extract the FULL question from the transcript, not this hint):\n${hint}` : '',
      ]
        .filter(Boolean)
        .join('\n');

  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: system.map(({ text }) => ({ text })) },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          // Gemini counts thinking tokens against maxOutputTokens; keep the answer budget whole.
          maxOutputTokens: template.maxTokens + THINKING_HEADROOM_TOKENS,
          thinkingConfig: { thinkingLevel: model === 'gemini-3.5-flash-lite' ? 'minimal' : 'low' },
        },
      }),
    },
  );

  if (!res.ok || !res.body) {
    const errBody = await res.text();
    logError({ message: 'gemini answer request failed', status: res.status, body: errBody.slice(0, 400) });
    if (res.status === 429) return errorJson('Gemini free-tier quota reached', 429);
    return errorJson('Gemini answer request failed', 502, { status: res.status });
  }

  return sseResponse(relayGeminiStream(res.body, knownQuestion, extractQuestion));
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

function relayGeminiStream(
  body: ReadableStream<Uint8Array>,
  knownQuestion: string,
  extractQuestion: boolean,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let questionEmitted = Boolean(knownQuestion);
  let preamble = '';
  let usage: Record<string, number> = {};
  let completed = false;

  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(encodeSse(event, data)));
      if (knownQuestion) send('question', { question: knownQuestion });

      const reader = body.getReader();
      try {
        stream: while (true) {
          const { done, value } = await reader.read();
          // At the end, flush the decoder and parse a last event that has no trailing blank line.
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = done ? '' : chunks.pop() ?? '';
          for (const chunk of chunks) {
            const payload = chunk.split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            if (!payload || payload === '[DONE]') continue;
            let parsed: {
              error?: { status?: string; message?: string };
              promptFeedback?: { blockReason?: string };
              candidates?: Array<{
                finishReason?: string;
                content?: { parts?: Array<{ text?: string; thought?: boolean }> };
              }>;
              usageMetadata?: Record<string, unknown>;
            };
            try {
              parsed = JSON.parse(payload) as typeof parsed;
            } catch {
              continue;
            }
            if (parsed.error) {
              throw new Error(parsed.error.message || parsed.error.status || 'Gemini stream error');
            }
            if (parsed.promptFeedback?.blockReason) {
              throw new Error(`Gemini prompt blocked: ${parsed.promptFeedback.blockReason}`);
            }
            if (parsed.usageMetadata) {
              usage = {};
              for (const key of [
                'promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount',
                'cachedContentTokenCount', 'totalTokenCount',
              ]) {
                const value = parsed.usageMetadata[key];
                if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
              }
            }
            for (const candidate of parsed.candidates ?? []) {
              if (!candidate.finishReason) continue;
              if (candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
                throw new Error(`Gemini answer stopped: ${candidate.finishReason}`);
              }
              completed = true;
            }
            for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
              if (part.thought || !part.text) continue;
              const piece = part.text;
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
              } else if (!extractQuestion && raw.length > 400 && !raw.includes('<<<QUESTION>>>')) {
                questionEmitted = true;
                send('question', { question: '' });
                send('token', { text: raw });
              } else {
                preamble = raw;
              }
            }
            if (completed) break stream;
          }
          if (done) break;
        }
        if (!completed) throw new Error('Gemini stream ended before finishReason');
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
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  });
}
