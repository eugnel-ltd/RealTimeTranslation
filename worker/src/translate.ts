import type { WorkerEnv } from './env';
import { errorJson, json, logError, readJson } from './http';
import { toTranslatorCode, translationLabel, uniqueTargets } from './languages';

export type TranslateBody = {
  text?: string;
  from?: string;
  to?: string[];
};

type AzureTranslation = { translations: Array<{ text: string; to: string }> };

export async function handleTranslate(
  request: Request,
  env: WorkerEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJson<TranslateBody>(request);
  const text = (body.text ?? '').trim();
  const requested = uniqueTargets(body.to ?? []);
  const mapped = requested.map(toTranslatorCode);
  const targets = uniqueTargets(mapped);
  if (!text) return errorJson('text is required', 400);
  if (targets.length === 0) return errorJson('to is required', 400);

  let res: Response;
  if (env.AZURE_TRANSLATOR_KEY) {
    res = await translateAzure(env, text, targets, body.from, fetchImpl);
  } else if (env.GEMINI_API_KEY) {
    res = await translateGemini(env, text, targets, body.from, fetchImpl);
  } else {
    return errorJson('No translation provider configured (set AZURE_TRANSLATOR_KEY or GEMINI_API_KEY)', 503);
  }
  return alignToRequested(res, mapped, targets);
}

async function alignToRequested(res: Response, mapped: string[], unique: string[]): Promise<Response> {
  if (!res.ok) return res;
  const payload = (await res.json()) as { translations: string[]; provider: string };
  const byCode = new Map(unique.map((code, i) => [code, payload.translations[i] ?? '']));
  return json({
    translations: mapped.map((code) => byCode.get(code) ?? ''),
    provider: payload.provider,
  });
}

async function translateAzure(
  env: WorkerEnv,
  text: string,
  targets: string[],
  from: string | undefined,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const params = new URLSearchParams({ 'api-version': '3.0' });
  if (from && from !== 'auto') params.set('from', toTranslatorCode(from));
  for (const to of targets) params.append('to', to);

  const res = await fetchImpl(
    `https://api.cognitive.microsofttranslator.com/translate?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_TRANSLATOR_KEY as string,
        'Ocp-Apim-Subscription-Region': env.AZURE_TRANSLATOR_REGION || 'global',
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify([{ Text: text }]),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    logError({ message: 'azure translator failed', status: res.status, body: errBody.slice(0, 400) });
    if (env.GEMINI_API_KEY) {
      return translateGemini(env, text, targets, from, fetchImpl);
    }
    return errorJson('Azure Translator request failed', 502, { status: res.status });
  }

  const data = (await res.json()) as AzureTranslation[];
  const translations = targets.map((to) => {
    const hit = data[0]?.translations?.find((t) => t.to.toLowerCase() === to.toLowerCase());
    return hit?.text ?? data[0]?.translations?.[targets.indexOf(to)]?.text ?? '';
  });
  return json({ translations, provider: 'azure-translator' });
}

async function translateGemini(
  env: WorkerEnv,
  text: string,
  targets: string[],
  from: string | undefined,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const model = env.GEMINI_TRANSLATE_MODEL || 'gemini-3.5-flash-lite';
  const specs = targets.map((code) => `- ${code}: ${translationLabel(code)}`).join('\n');
  const source = from && from !== 'auto' ? translationLabel(from) : 'auto-detected source language';

  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': env.GEMINI_API_KEY as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: 'You are a professional interpreter. Return JSON only. No commentary. For yue/zh-HK write colloquial spoken Hong Kong Cantonese (口語粵語) in Traditional Chinese characters, using particles such as 嘅/咗/唔 — not formal written Chinese (書面語), not Mandarin, and not Simplified Chinese.',
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Translate the source text into each target language.\nSource (${source}): ${JSON.stringify(text)}\nTargets:\n${specs}\nReturn {"translations":[{"to":"<code>","text":"<translation>"}]} in the same order as Targets.`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    logError({ message: 'gemini translate failed', status: res.status, body: errBody.slice(0, 400) });
    return errorJson('Gemini translation failed', 502, { status: res.status });
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let parsed: { translations?: Array<{ to?: string; text?: string }> };
  try {
    parsed = JSON.parse(raw) as { translations?: Array<{ to?: string; text?: string }> };
  } catch {
    return errorJson('Gemini translation returned invalid JSON', 502);
  }

  const translations = targets.map((to) => {
    const hit = parsed.translations?.find((t) => (t.to ?? '').toLowerCase() === to.toLowerCase());
    return hit?.text ?? '';
  });
  return json({ translations, provider: 'gemini' });
}
