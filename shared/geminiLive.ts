import { isCantoneseUiCode, toGeminiLiveCode } from '../worker/src/languages';

export type GeminiLiveMode = 'transcribe' | 'translate';

export const CANTONESE_LIVE_INSTRUCTION =
  'Translate into colloquial spoken Hong Kong Cantonese (口語粵語) in Traditional Chinese characters. Use spoken particles such as 嘅, 咗, 唔, 喺, 咁. Do not use formal written Chinese (書面語) or Mandarin.';

/** Live `setup` / `bidiGenerateContentSetup` body. Transcription fields are top-level. */
export function geminiLiveSetup(
  mode: GeminiLiveMode,
  model: string,
  targetLanguage = 'en',
): Record<string, unknown> {
  const modelName = model.startsWith('models/') ? model : `models/${model}`;
  if (mode === 'translate') {
    const setup: Record<string, unknown> = {
      model: modelName,
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: {
          targetLanguageCode: toGeminiLiveCode(targetLanguage),
          echoTargetLanguage: false,
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    if (isCantoneseUiCode(targetLanguage)) {
      setup.systemInstruction = { parts: [{ text: CANTONESE_LIVE_INSTRUCTION }] };
    }
    return setup;
  }
  return {
    model: modelName,
    generationConfig: { responseModalities: ['TEXT'] },
    inputAudioTranscription: { languageCodes: [] as string[] },
  };
}
